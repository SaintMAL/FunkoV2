const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const express = require("express");
const fs = require('fs');
require('dotenv').config();

const app = express();

let fetch;
(async () => {
  fetch = (await import('node-fetch')).default;
})();

app.get("/", (req, res) => {
  res.send("Bot is alive");
});

const port = 3000;
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

const collections = [
  { collectionName: 'tformr.funko', templateId: 784092 },
  { collectionName: 'fools.funko', templateId: 789403 },
  { collectionName: 'funime.funko', templateId: 795119, templateId2: 795122 } // New collection with templateId2
];

let notificationTimeout;
let lastNotificationMessageId = {};

bot.onText(/\/checkprice/, async (msg) => {
  for (const collection of collections) {
    try {
      const photo = await getPhoto(collection.collectionName);
      const title = await getCollectionData(collection.collectionName);
      const prices = await getPrices(collection.templateId, collection.collectionName, collection.templateId2);
      const caption = `<b>${title}</b>\n\n${prices}`;
      await bot.sendPhoto(msg.chat.id, photo, { caption, parse_mode: 'HTML' });
    } catch (error) {
      console.error(error);
      bot.sendMessage(msg.chat.id, `Error occurred while fetching data for collection ${collection.collectionName}.`);
    }
  }
});

bot.onText(/\/enablenotifications(?: (\d+))?/, (msg, match) => {
  const intervalMinutes = match[1] ? Number(match[1]) : 5;
  if (isNaN(intervalMinutes) || intervalMinutes <= 0) {
    bot.sendMessage(msg.chat.id, 'Invalid notification interval. Please enter a number greater than zero.');
    return;
  }

  clearTimeout(notificationTimeout);
  lastNotificationMessageId = {};

  bot.sendMessage(msg.chat.id, `Price notifications enabled! Notifications will be sent every ${intervalMinutes} minutes.`);

  const sendNotifications = async () => {
    for (const collection of collections) {
      try {
        if (lastNotificationMessageId[collection.collectionName]) {
          await bot.deleteMessage(msg.chat.id, lastNotificationMessageId[collection.collectionName]);
        }

        const photo = await getPhoto(collection.collectionName);
        const title = await getCollectionData(collection.collectionName);
        const prices = await getPrices(collection.templateId, collection.collectionName, collection.templateId2);
        const caption = `<b>${title}</b>\n\n${prices}`;
        const newMessage = await bot.sendPhoto(msg.chat.id, photo, { caption, parse_mode: 'HTML' });

        lastNotificationMessageId[collection.collectionName] = newMessage.message_id;
      } catch (error) {
        console.error('Error sending notification:', error);
      }
    }

    notificationTimeout = setTimeout(sendNotifications, intervalMinutes * 60 * 1000);
  };

  sendNotifications();
});

bot.onText(/\/disablenotifications/, (msg) => {
  if (notificationTimeout) {
    clearTimeout(notificationTimeout);
    notificationTimeout = null;
    bot.sendMessage(msg.chat.id, 'Price notifications disabled!');
  } else {
    bot.sendMessage(msg.chat.id, 'Notifications are already disabled.');
  }
});

async function getPrices(templateId, collectionName, templateId2 = null) {
  const templateIdToUse = templateId2 || templateId + 1;
  const apiUrls = [
    {
      url: `https://wax.api.atomicassets.io/atomicmarket/v2/sales?state=1&collection_name=${collectionName}&template_id=${templateIdToUse}&page=1&limit=100&order=asc&sort=price`,
      label: 'Premium Pack:'
    },
    {
      url: `https://wax.api.atomicassets.io/atomicmarket/v2/sales?state=1&collection_name=${collectionName}&template_id=${templateId}&page=1&limit=100&order=asc&sort=price`,
      label: 'Standard Pack:'
    }
  ];

  const pricePromises = apiUrls.map(getPrice);
  const results = await Promise.allSettled(pricePromises);
  return results.map((result) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return `Failed to fetch price: ${result.reason}`;
    }
  }).join('\n');
}

async function getPrice(item) {
  try {
    const response = await fetch(item.url);
    const responseResult = await response.json();
    if (response.ok && responseResult.data && responseResult.data.length > 0) {
      const { price, listing_symbol, listing_price } = responseResult.data[0];
      const formattedPrice = price.amount / 100000000;
      let message = `${item.label} ${formattedPrice.toFixed(2)} WAX`;
      if (listing_symbol === 'USD') {
        message += ` (${listing_price / 100} USD)`;
      } else {
        const waxPrice = await getWaxPrice();
        message += ` (${(formattedPrice * waxPrice).toFixed(2)} USD)`;
      }
      return message;
    } else {
      throw new Error(`Failed to fetch price for ${item.label}`);
    }
  } catch (error) {
    console.error('Error fetching price:', error);
    return `Failed to fetch price for ${item.label}: ${error.message}`;
  }
}

async function getWaxPrice() {
  try {
    const response = await fetch("https://api.coincap.io/v2/assets/wax");
    const responseResult = await response.json();
    if (response.ok) {
      return responseResult.data.priceUsd;
    } else {
      throw new Error('Error fetching WAX price.');
    }
  } catch (error) {
    console.error('Error fetching WAX price:', error);
    throw error;
  }
}

async function getPhoto(collectionName) {
  try {
    const response = await fetch(`https://wax.api.atomicassets.io/atomicassets/v1/collections/${collectionName}`);
    const responseResult = await response.json();
    const photoUrl = 'https://atomichub-ipfs.com/ipfs/' + JSON.parse(responseResult.data.data.images).logo_512x512;
    const photoResponse = await fetch(photoUrl);
    return await photoResponse.buffer();
  } catch (error) {
    console.error('Error fetching photo:', error);
    throw error;
  }
}

async function getCollectionData(collectionName) {
  try {
    const response = await fetch(`https://wax.api.atomicassets.io/atomicassets/v1/assets?collection_name=${collectionName}&schema_name=packs.drop&page=1&limit=1&order=desc&sort=name`);
    const responseResult = await response.json();
    return responseResult.data[0].collection.name;
  } catch (error) {
    console.error('Error fetching collection data:', error);
    throw error;
  }
}

module.exports = app;
