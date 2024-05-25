const express = require("express");
const fetch = require("node-fetch");
const { Chat } = require("../models/UserSchema");
const router = express.Router();
require("dotenv").config();

const token = process.env.BOT_TOKEN;

router.post("/createInviteLink", async (req, res) => {
  const { chatId, durationMonths } = req.query;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/createChatInviteLink?chat_id=${chatId}&member_limit=1`
    );

    if (!response.ok) {
      throw new Error(data.description);
    }
    const data = await response.json();
    const inviteLink = data.result.invite_link;
    const newChat = await Chat.findOneAndUpdate(
      { chatId },
      {
        $push: {
          inviteLinks: {
            inviteLink,
            durationMonths,
            expirationDate: new Date(Date.now() + durationMonths * 30 * 24 * 60 * 60 * 1000),
          },
        },
      },
      { new: true, upsert: true }
    );
    res.json({ inviteLink: newChat.inviteLinks.slice(-1)[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/revokeInviteLink", async (req, res) => {
  const { chatId, inviteChatLink } = req.query;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/revokeChatInviteLink?chat_id=${chatId}&invite_link=${inviteChatLink}`
    );
    const data = await response.json();
    if (!data.ok) {
      throw new Error("Link not revoked");
    }
    const inviteLink = data.result.invite_link;
    res.json({ inviteLink });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/removeMember", async (req, res) => {
  const { chatId, userId } = req.body;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/unbanChatMember?chat_id=${chatId}&user_id=${userId}`,
      { method: "POST" }
    );
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
