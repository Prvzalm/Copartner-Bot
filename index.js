const { Telegraf } = require("telegraf");
const mongoose = require("mongoose");
const express = require("express");
const { Chat } = require("./models/UserSchema");
require("dotenv").config();

const app = express();
const PORT = 3001;
const chatId = "-1001990449945";
const userId = 6986242569;
const uri = process.env.MONGO_DB;

mongoose
  .connect(uri)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

const token = process.env.BOT_TOKEN;
const bot = new Telegraf(token);

bot.start((ctx) => ctx.reply("Welcome to Copartner.in"));

bot.on("chat_member", async (ctx) => {
  console.log(ctx.chatMember.new_chat_member.user.id);
});

bot.on("channel_post", async (ctx) => {
  const chatId = ctx.chat.id;
  const channelName = ctx.chat.title;
  const userName = ctx.chat.username;

  try {
    const existingChat = await Chat.findOne({ chatId: chatId });

    if (!existingChat) {
      const chat = new Chat({
        chatId: chatId,
        channelName: channelName,
      });
      await chat.save();
      console.log("Chat ID saved:", chatId, "for ChannelName:", channelName);
    } else {
      console.log("Chat ID already exists:", chatId, channelName);
    }
  } catch (error) {
    console.error("Error saving chat ID:", error);
  }
});

async function createInviteLink(chatId) {
  try {
    const memberLimit = "1";
    const response = await fetch(
      `https://api.telegram.org/bot${token}/createChatInviteLink?chat_id=${chatId}&member_limit=${memberLimit}`
    );
    const data = await response.json();
    const inviteLink = data.result.invite_link;
    console.log(inviteLink);
  } catch (error) {
    console.log(error);
  }
}

async function removeMember(chatId, userId) {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/unbanChatMember?chat_id=${chatId}&user_id=${userId}`,
      { method: "POST" }
    );
    const data = await response.json();
    console.log(data);
  } catch (error) {
    console.log(error);
  }
}

// functions calling here
// createInviteLink(chatId);
// removeMember(chatId, userId);

bot.launch({
  allowedUpdates: ["channel_post", "chat_member"],
});

app.listen(PORT, () => console.log(`Server is running on Port ${PORT}`));
