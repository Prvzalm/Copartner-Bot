const express = require("express");
const fetch = require("node-fetch");
const { Chat } = require("../models/UserSchema");
const axios = require("axios");
const sha256 = require("sha256");
const router = express.Router();
require("dotenv").config();

const token = process.env.BOT_TOKEN;
const MERCHANT_ID = process.env.MERCHANT_ID;
const PHONE_PE_HOST_URL = process.env.PHONE_PE_HOST_URL;
const SALT_INDEX = 1;
const SALT_KEY = process.env.SALT_KEY;
const APP_BE_URL = process.env.APP_BE_URL;

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
            expirationDate: new Date(
              Date.now() + durationMonths * 30 * 24 * 60 * 60 * 1000
            ),
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

router.post("/pay", async (req, res) => {
  try {
    const { returnUrl, plan } = req.body;
    const merchantTransactionId = req.body.transactionId;
    const data = {
      merchantId: MERCHANT_ID,
      merchantTransactionId: merchantTransactionId,
      name: req.body.name,
      amount: req.body.amount * 100,
      redirectUrl: `${APP_BE_URL}/api/payment/callback?id=${merchantTransactionId}&returnUrl=${encodeURIComponent(
        returnUrl
      )}&planType=${plan}`,
      redirectMode: "POST",
      merchantUserId: req.body.MID,
      paymentInstrument: {
        type: "PAY_PAGE",
      },
    };
    const bufferObj = Buffer.from(JSON.stringify(data), "utf8");
    const base64EncodedPayload = bufferObj.toString("base64");
    const string = base64EncodedPayload + "/pg/v1/pay" + SALT_KEY;
    const sha256_val = sha256(string);
    const xVerifyChecksum = sha256_val + "###" + SALT_INDEX;

    const response = await axios.post(
      `${PHONE_PE_HOST_URL}/pg/v1/pay`,
      {
        request: base64EncodedPayload,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-VERIFY": xVerifyChecksum,
          accept: "application/json",
        },
      }
    );
    res.json(response.data);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

router.post("/payment/callback", async (req, res) => {
  try {
    const merchantTransactionId = req.query.id;
    const { returnUrl, planType } = req.query;
    if (!merchantTransactionId) {
      throw new Error(
        `Cannot find Merchant Transaction ID ${merchantTransactionId}`
      );
    }
    const statusUrl = `${PHONE_PE_HOST_URL}/pg/v1/status/${MERCHANT_ID}/${merchantTransactionId}`;
    const string =
      `/pg/v1/status/${MERCHANT_ID}/${merchantTransactionId}` + SALT_KEY;
    const sha256_val = sha256(string);
    const xVerifyChecksum = sha256_val + "###" + SALT_INDEX;

    const options = {
      method: "GET",
      url: statusUrl,
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "X-VERIFY": xVerifyChecksum,
        "X-MERCHANT-ID": MERCHANT_ID,
      },
    };

    axios
      .request(options)
      .then(function (response) {
        if (response.data.success) {
          return res.redirect(
            `${decodeURIComponent(
              returnUrl
            )}?status=success&transactionId=${merchantTransactionId}&planType=${planType}`
          );
        }
        return res.redirect(
          `${decodeURIComponent(
            returnUrl
          )}?status=failure&transactionId=${merchantTransactionId}`
        );
      })
      .catch(function (error) {
        console.error(error);
      });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: error.message });
  }
});

// router.post("/revokeInviteLink", async (req, res) => {
//   const { chatId, inviteChatLink } = req.query;

//   try {
//     const response = await fetch(
//       `https://api.telegram.org/bot${token}/revokeChatInviteLink?chat_id=${chatId}&invite_link=${inviteChatLink}`
//     );
//     const data = await response.json();
//     if (!data.ok) {
//       throw new Error("Link not revoked");
//     }
//     const inviteLink = data.result.invite_link;
//     res.json({ inviteLink });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// router.post("/removeMember", async (req, res) => {
//   const { chatId, userId } = req.body;

//   try {
//     const response = await fetch(
//       `https://api.telegram.org/bot${token}/unbanChatMember?chat_id=${chatId}&user_id=${userId}`,
//       { method: "POST" }
//     );
//     const data = await response.json();
//     res.json(data);
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

module.exports = router;
