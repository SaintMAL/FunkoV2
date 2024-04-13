const TelegramBot = require("node-telegram-bot-api");
const axinpmos = require("axios");
const express = require("express");
const app = express(); 

let fetch;

(async () => {
  fetch = (await import('node-fetch')).default;
})();

const fs = require('fs');
require('dotenv').config();

app.get("/", (req, res) => {
  res.send("Bot is alive");
});

const port = 3000;
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

let notificationTimeout;
let lastNotificationMessageId;

bot.onText(/\/checkprice/, async (msg) => {
  const collections = [
    { collectionName: 'tformr.funko', templateId: 784092 },
    { collectionName: 'fools.funko', templateId: 789403 }
  ];

  for (const collection of collections) {
    try {
      const photo = await getPhoto(collection.collectionName);
      const title = await getСollectionData(collection.collectionName);
      const prices = await getPrices(collection.templateId, collection.collectionName);
      const caption = `<b>${title}</b>\n\n${prices}`;
      await bot.sendPhoto(msg.chat.id, photo, { caption, parse_mode: 'HTML' });
    } catch (error) {
      console.log(error);
      bot.sendMessage(msg.chat.id, `Виникла помилка при виконанні запиту для колекції ${collection.collectionName}.`);
    }
  }
});


bot.onText(/\/enablenotifications(?: (\d+))?/, async (msg, match) => {
  const intervalMinutes = match[1] ? Number(match[1]) : 5;
  if (isNaN(intervalMinutes) || intervalMinutes <= 0) {
    bot.sendMessage(msg.chat.id, 'Некоректно вказаний інтервал сповіщень. Будь ласка, введіть число більше нуля.');
    return;
  }

  clearTimeout(notificationTimeout);
  lastNotificationMessageId = null;

  bot.sendMessage(msg.chat.id, `Сповіщення про ціну увімкнені! Сповіщення будуть надходити кожні ${intervalMinutes} хвилин.`);

  const sendNotifications = async () => {
    const collections = [
      { collectionName: 'tformr.funko', templateId: 784092 },
      { collectionName: 'fools.funko', templateId: 789403 }
    ];
  
    for (const collection of collections) {
      try {
        // Перевірка, чи існує ID останнього повідомлення перед видаленням
        if (lastNotificationMessageId && lastNotificationMessageId[collection.collectionName]) {
          await bot.deleteMessage(msg.chat.id, lastNotificationMessageId[collection.collectionName]);
        }
  
        const photo = await getPhoto(collection.collectionName);
        const title = await getСollectionData(collection.collectionName);
        const prices = await getPrices(collection.templateId, collection.collectionName);
        const caption = `<b>${title}</b>\n\n${prices}`;
        const newMessage = await bot.sendPhoto(msg.chat.id, photo, { caption, parse_mode: 'HTML' });
  
        // Оновлення ID останнього повідомлення для кожної колекції
        lastNotificationMessageId = lastNotificationMessageId || {};
        lastNotificationMessageId[collection.collectionName] = newMessage.message_id;
      } catch (error) {
        console.log('Помилка при надсиланні сповіщення:', error);
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
    bot.sendMessage(msg.chat.id, 'Сповіщення про ціну вимкнені!');
  } else {
    bot.sendMessage(msg.chat.id, 'Сповіщення вже вимкнені.');
  }
});


async function getPrices(templateId, collectionName) {
  const apiUrls = [
    {
      url: `https://wax.api.atomicassets.io/atomicmarket/v2/sales?state=1&collection_name=${collectionName}&template_id=${templateId + 1}&page=1&limit=100&order=asc&sort=price`,
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
      return `Не вдалося отримати ціну: ${result.reason}`;
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
      throw new Error(`Не вдалося отримати ціну ${item.label}`);
    }
  } catch (error) {
    console.log('Помилка при отриманні ціни:', error);
    return {
      label: item.label,
      message: error.message
    };
  }
}

async function getWaxPrice() {
  try {
    const server = "https://api.coincap.io/v2/assets/wax";
    const response = await fetch(server);
    const responseResult = await response.json();
    if (response.ok) {
      return responseResult.data.priceUsd;
    } else {
      throw new Error('Помилка при отриманні ціни WAX.');
    }
  } catch (error) {
    console.log('Помилка при отриманні ціни WAX:', error);
    throw error;
  }
}


async function getPhoto(collectionName) {
  const server = 'https://wax.api.atomicassets.io/atomicassets/v1/collections/' + collectionName;
  const response = await fetch(server, { method: 'GET' });
  const responseResult = await response.json();

  const photoUrl = 'https://atomichub-ipfs.com/ipfs/' + (JSON.parse(responseResult.data.data.images)).logo_512x512;

  const photoResponse = await fetch(photoUrl);
  const photo = await photoResponse.buffer();

  return photo;
}


async function getСollectionData(collectionName) {
  const server = 'https://wax.api.atomicassets.io/atomicassets/v1/assets?collection_name=' + collectionName + '&schema_name=packs.drop&page=1&limit=1&order=desc&sort=name';
  const response = await fetch(server, { method: 'GET' });
  const responseResult = await response.json();

  const title = responseResult.data[0].collection.name;
  //const templateId = responseResult.data[0].template.template_id;
  return title;
}

module.exports = app;
