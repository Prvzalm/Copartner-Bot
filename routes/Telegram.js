const express = require("express");
const fetch = require("node-fetch");
const { Chat } = require("../models/UserSchema");
const axios = require("axios");
const sha256 = require("sha256");
const { ChatName } = require("../models/ChatNameSchema");
const router = express.Router();
require("dotenv").config();

const token = process.env.BOT_TOKEN;
const MERCHANT_ID = process.env.MERCHANT_ID;
const PHONE_PE_HOST_URL = process.env.PHONE_PE_HOST_URL;
const SALT_INDEX = 1;
const SALT_KEY = process.env.SALT_KEY;
const APP_BE_URL = process.env.APP_BE_URL;
const key = process.env.FAST2SMS_API_KEY;
const senderId = process.env.SENDER_ID;

const createInviteLink = async (chatId, durationMonths) => {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/createChatInviteLink?chat_id=${chatId}&member_limit=1`
    );

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.description);
    }
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
    return { inviteLink: newChat.inviteLinks.slice(-1)[0].inviteLink }; // Assuming you need the invite link string
  } catch (error) {
    console.error(`Failed to create invite link: ${error.message}`);
    throw error;
  }
};

const sendSMS = async (mobileNumber, inviteLink) => {
  try {
    const inviteCode = inviteLink.split("https://t.me/")[1];

    if (!inviteCode) {
      throw new Error("Invalid invite link format");
    }

    const response = await fetch(
      `https://www.fast2sms.com/dev/bulkV2?authorization=${key}&route=dlt&sender_id=${senderId}&message=169464&variables_values=${inviteCode}&flash=0&numbers=${mobileNumber}`
    );
    if (response.ok) {
      console.log(
        `SMS sent to mobile ${mobileNumber} with invite link ${inviteLink}`
      );
    } else {
      console.log(response.error);
    }
  } catch (error) {
    throw new Error(`Failed to send SMS: ${error.message}`);
  }
};

router.post("/pay", async (req, res) => {
  try {
    const {
      returnUrl,
      plan,
      chatId,
      subscriptionId,
      userId,
      totalAmount,
      transactionId,
      mobileNumber,
      transactionDate,
    } = req.body;
    const data = {
      merchantId: MERCHANT_ID,
      merchantTransactionId: transactionId,
      amount: totalAmount * 100,
      redirectUrl: `${APP_BE_URL}/api/payment/callback?id=${transactionId}&returnUrl=${encodeURIComponent(
        returnUrl
      )}&planType=${plan}&chatId=${chatId}&subscriptionId=${subscriptionId}&userId=${userId}&totalAmount=${totalAmount}&mobileNumber=${mobileNumber}&transactionDate=${transactionDate}`,
      redirectMode: "POST",
      merchantUserId: userId,
      paymentInstrument: {
        type: "PAY_PAGE",
      },
    };
    console.log(data);
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
    console.log(response.data);
    res.json(response.data);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

router.post("/payment/callback", async (req, res) => {
  try {
    const {
      id: transactionId,
      returnUrl,
      planType,
      chatId,
      subscriptionId,
      userId,
      totalAmount,
      mobileNumber,
      transactionDate,
    } = req.query;
    console.log(
      "req.query",
      transactionId,
      subscriptionId,
      userId,
      totalAmount
    );
    if (!transactionId) {
      throw new Error(`Cannot find Merchant Transaction ID`);
    }
    const statusUrl = `${PHONE_PE_HOST_URL}/pg/v1/status/${MERCHANT_ID}/${transactionId}`;
    const string = `/pg/v1/status/${MERCHANT_ID}/${transactionId}` + SALT_KEY;
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

    const response = await axios.request(options);
    if (response.data.success) {
      try {
        const paymentMode = response.data.data.paymentInstrument.type;
        const result = await createInviteLink(chatId, planType);
        if (!result.inviteLink) {
          throw new Error("Failed to create invite link");
        }
        const subscriber = await postSubscriberData(
          transactionId,
          subscriptionId,
          userId,
          totalAmount,
          paymentMode,
          transactionDate,
          result.inviteLink
        );
        if (!subscriber.response.ok) {
          throw new Error("Failed to POST subscriber API");
        }
        const sendSMSOn = await sendSMS(mobileNumber, result.inviteLink);
        console.log(result.inviteLink, chatId);
        return res.redirect(
          `${decodeURIComponent(
            returnUrl
          )}?status=success&transactionId=${transactionId}&inviteLink=${
            result.inviteLink
          }`
        );
      } catch (error) {
        console.error("Error while creating invite link:", error);
        return res.status(500).json({ error: error.message });
      }
    } else {
      return res.redirect(
        `${decodeURIComponent(
          returnUrl
        )}?status=failure&transactionId=${transactionId}`
      );
    }
  } catch (error) {
    console.error("Error in callback:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/getChatNames", async (req, res) => {
  try {
    const chatNames = await ChatName.find();
    res.json(chatNames);
  } catch (error) {
    console.error("Failed to fetch chat names:", error);
    res.status(500).json({ message: "Failed to retrieve chat names" });
  }
});

const postSubscriberData = async (
  transactionId,
  subscriptionId,
  userId,
  totalAmount,
  paymentMode,
  transactionDate,
  premiumTelegramChannel
) => {
  const gstAmount = (totalAmount * 0.18).toFixed(2);

  const data = {
    subscriptionId,
    userId,
    gstAmount,
    totalAmount,
    paymentMode,
    transactionId,
    transactionDate,
    isActive: true,
    premiumTelegramChannel,
  };

  try {
    const response = await axios.post(
      "https://copartners.in:5009/api/Subscriber",
      data,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (response.status === 200) {
      console.log("Data posted successfully:", response.data);
      return response.data;
    } else {
      console.error(
        "Failed to post data:",
        response.status,
        response.statusText
      );
    }
  } catch (error) {
    console.error("Error posting data:", error.message);
  }
};

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
