const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();
require("dotenv").config();

const token = process.env.BOT_TOKEN;

router.post('/createInviteLink', async (req, res) => {
  const { chatId } = req.query;

  try {
    const memberLimit = "1";
    const response = await fetch(
      `https://api.telegram.org/bot${token}/createChatInviteLink?chat_id=${chatId}&member_limit=${memberLimit}`
    );
    const data = await response.json();
    const inviteLink = data.result.invite_link;
    res.json({ inviteLink });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/revokeInviteLink', async (req, res) => {
  const { chatId, inviteLink } = req.query;

  try {
    const memberLimit = "1";
    const response = await fetch(
      `https://api.telegram.org/bot${token}/revokeChatInviteLink?chat_id=${chatId}&invite_link=${inviteLink}`
    );
    const data = await response.json();
    const inviteLink = data.result.invite_link;
    res.json({ inviteLink });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/removeMember', async (req, res) => {
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
