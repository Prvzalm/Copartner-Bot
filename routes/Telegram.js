const express = require("express");
const fetch = require("node-fetch");
const { Chat } = require("../models/UserSchema");
const axios = require("axios");
const cron = require("node-cron");
const sha256 = require("sha256");
const { ChatName } = require("../models/ChatNameSchema");
const router = express.Router();
const fs = require("fs");
const Razorpay = require('razorpay');
const path = require("path");
const moment = require("moment");
const crypto = require('crypto');
const JoinBot = require("../models/JoinBotSchema");
const ChatMember = require("../models/ChatMemberSchema");
const { Telegraf } = require("telegraf");
require("dotenv").config();

const token = process.env.BOT_TOKEN;
const MERCHANT_ID = process.env.MERCHANT_ID;
const PHONE_PE_HOST_URL = process.env.PHONE_PE_HOST_URL;
const SALT_INDEX = 1;
const SALT_KEY = process.env.SALT_KEY;
const APP_BE_URL = process.env.APP_BE_URL;
const key = process.env.FAST2SMS_API_KEY;
const senderId = process.env.SENDER_ID;

const bot = new Telegraf(token);

const razorpayInstance = new Razorpay({
  key_id: 'rzp_test_9lu374ftxzhZBK', // Replace with your Razorpay key ID
  key_secret: 'TL4S2p3AEFY3mGH5oJf9m8BK' // Replace with your Razorpay secret key
});

const createInviteLink = async (
  chatId,
  durationMonths,
  isDays,
  userId,
  number
) => {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/createChatInviteLink?chat_id=${chatId}&member_limit=1`
    );

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.description);
    }
    const inviteLink = data.result.invite_link;

    // Get current UTC time and convert it to IST
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // IST offset in milliseconds
    const istNow = new Date(now.getTime() + istOffset);

    const dayOfWeek = istNow.getDay(); // 0 for Sunday, 1 for Monday, ..., 5 for Friday, 6 for Saturday

    // Define the 3:30 PM time limit in IST
    const timeLimitHours = 15;
    const timeLimitMinutes = 30;
    const timeLimit = new Date(
      istNow.getFullYear(),
      istNow.getMonth(),
      istNow.getDate(),
      timeLimitHours,
      timeLimitMinutes
    );

    const currentTime = istNow; // Current IST time

    // Log to verify the 3:30 PM time limit and current IST time
    console.log("Current IST Time:", currentTime.toString());
    console.log("3:30 PM IST Time Limit:", timeLimit.toString());

    let additionalDays = 0;
    if (isDays && isDays !== "false" && durationMonths === 2) {
      switch (dayOfWeek) {
        case 4: // Thursday
          additionalDays = currentTime > timeLimit ? 3 : 0;
          break;
        case 5: // Friday
          additionalDays = currentTime > timeLimit ? 3 : 2;
          break;
        case 6: // Saturday
          additionalDays = 2;
          break;
        case 0: // Sunday
          additionalDays = currentTime < timeLimit ? 1 : 0;
          break;
        default:
          additionalDays = 0;
          break;
      }
    }

    // Calculate expiration date based on IST and additionalDays
    let expirationDate;
    if (!isDays || isDays === "false") {
      expirationDate = new Date(
        istNow.getTime() + durationMonths * 30 * 24 * 60 * 60 * 1000
      );
    } else {
      expirationDate = new Date(
        istNow.getTime() +
          durationMonths * 24 * 60 * 60 * 1000 +
          additionalDays * 24 * 60 * 60 * 1000
      );
    }

    console.log(
      { additionalDays },
      { expirationDate },
      { dayOfWeek },
      { istNow }
    );

    const newChat = await Chat.findOneAndUpdate(
      { chatId },
      {
        $push: {
          inviteLinks: {
            inviteLink,
            userId,
            number,
            durationMonths,
            expirationDate,
            isDays,
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

const sendCallMessageToGroup = async ({
  name,
  method,
  above,
  below,
  target1,
  target2,
  target3,
  target4,
  stopLoss,
  chatId,
}) => {
  // Build the message dynamically based on provided values
  let message = `💥 STOCK ALERT 💥\n\n${name} | ${method} - Just a Quick Look 👀\n`;

  // Add optional fields only if they exist
  if (above) {
    message += `🤘 Above: ${above}\n`;
  }
  if (below) {
    message += `📉 Below: ${below}\n`;
  }

  const targets = [target1, target2, target3, target4].filter((t) => t !== undefined && t !== null);
  if (targets.length > 0) {
    message += `🎯 Potential Range: ${targets.join(' to ')}\n`;
  }

  message += `📦 Stop Loss: ${stopLoss}\n\n`;
  message += `Keep it on your radar – a move could be brewing! 🚀`;

  try {
    // Send the dynamically generated message
    await bot.telegram.sendMessage(chatId, message);
    console.log('Message sent successfully:');
  } catch (error) {
    console.error('Error sending message:', error);
    // Handle the error as needed (e.g., retry logic, notify admin, etc.)
  }
};

router.post('/sendCallMessageToGroup', async (req, res) => {
  const { name, method, above, below, target1, target2, target3, target4, stopLoss, chatId } = req.body;

  if (!name || !method || !stopLoss || !chatId) {
    return res.status(400).json({ error: 'All parameters are required' });
  }

  try {
    await sendCallMessageToGroup({ name, method, above, below, target1, target2, target3, target4, stopLoss, chatId });
    res.status(200).json({ success: 'Message sent to group' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

const sendTargetHitMessage = async ({ name, action, above, targetHit, stopLoss, chatId }) => {
  // Dynamically construct the message
  const messages = [
    `🔥 ${name} 🔥

${above ? `Entry: ${above}\n` : ''}🎯 ${targetHit ? `Target Reached: ${targetHit}\n` : ''}
${stopLoss ? `📦 Stop Loss: ${stopLoss}\n` : ''}

🚀 Steady climb – Target Locked In! 🚀
Let’s keep riding the wave, team! 🌊💪`,


    `💥 ${name} 💥

${targetHit ? `Target: ⬆️ ${targetHit} Target Achieved 🎯\n` : ''}
👏 Another target locked – great momentum! 👏
Stay tuned, this trade’s got legs! 💸`,


    `🏆 TARGET HIT ALERT 🏆

${name}${targetHit ? `: Target: ⬆️ ${targetHit}\n` : ''}
${above ? `Entry: ${above}\n` : ''}${stopLoss ? `📦 Stop Loss: ${stopLoss}\n` : ''}
🔥 Solid gains incoming! Ready for the next move? 💪`
  ];

  const getRandomMessage = (messageArray) => {
    const randomIndex = Math.floor(Math.random() * messageArray.length);
    return messageArray[randomIndex];
  };

  // Select a random message
  const selectedMessage = getRandomMessage(messages);

  try {
    // Send the selected message to the specified chatId
    await bot.telegram.sendMessage(chatId, selectedMessage);
    console.log('Message sent successfully:');
  } catch (error) {
    console.error('Error sending message:', error);
    // Handle the error as needed (e.g., retry logic, notify admin, etc.)
  }
};

router.post('/sendTargetHitMessage', async (req, res) => {
  const { name, action, chatId, above, targetHit, stopLoss } = req.body;

  // Validate required parameters
  if (!name || !action || !chatId) {
    return res.status(400).json({ error: 'Name, action, and chatId are required' });
  }

  try {
    await sendTargetHitMessage({ name, action, above, targetHit, stopLoss, chatId });
    res.status(200).json({ success: 'Message sent to group' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

const sendSLMessage = async ({name, action, targetStopLoss, stopLoss, chatId}) => {
  const messages = [
    `⚠️❌ STOP LOSS ALERT ❌ ⚠️

${name} || ${action}: ${targetStopLoss} ➡️ ${stopLoss}`
  ]

  try {
    // Send the selected message to the specified chatId
    await bot.telegram.sendMessage(chatId, messages[0]);
    console.log('Message sent successfully:');
  } catch (error) {
    console.error('Error sending message:', error);
    // Handle the error as needed (e.g., retry logic, notify admin, etc.)
  }
};

router.post('/sendSLMessage', async (req, res) => {
  const { name, action, targetStopLoss, stopLoss, chatId } = req.body;

  if (!name || !action || !targetStopLoss || !stopLoss || !chatId) {
    return res.status(400).json({ error: 'All parameters are required' });
  }

  try {
    await sendSLMessage({ name, action, targetStopLoss, stopLoss, chatId });
    res.status(200).json({ success: 'Message sent to group' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

const sendExitCallMessage = async ({ name, above, stopLoss, targetHit, chatId }) => {
  // Construct the message dynamically
  let message = `
🎉💥 EXIT CALL ALERT 💥🎉 

💥 ${name} 💥
`;

  if (above) {
    message += `🔥 Above: ${above}\n`;
  }
  if (stopLoss) {
    message += `💥 Stop Loss: ${stopLoss}\n`;
  }
  if (targetHit) {
    message += `🎯 Target Hit: ${targetHit} 🔥💥\n`;
  }

  message += `
💪 Mission accomplished! Celebrate the win! 💪
Keep up the momentum, traders! 🏆
`;

  try {
    // Send the message
    await bot.telegram.sendMessage(chatId, message);
    console.log('Exit Call message sent successfully.');
  } catch (error) {
    console.error('Error sending Exit Call message:', error);
    throw error;
  }
};

router.post('/sendExitCallMessage', async (req, res) => {
  const { name, above, stopLoss, targetHit, chatId } = req.body;

  // Validate required parameters
  if (!name || !chatId) {
    return res.status(400).json({ error: 'Name and chatId are required.' });
  }

  try {
    await sendExitCallMessage({ name, above, stopLoss, targetHit, chatId });
    res.status(200).json({ success: 'Exit Call message sent to group successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send Exit Call message. Please try again later.' });
  }
});

const sendPostRequest = async (phoneNumber) => {
  const url = "https://backend.aisensy.com/campaign/t1/api/v2";
  const data = {
    apiKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2MmM5ZWNiOTNhMmJkMGFlZTVlMGZiMiIsIm5hbWUiOiJIYWlsZ3JvIHRlY2ggc29sdXRpb25zIHB2dC4gbHRkLiIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2NjJjOWVjYjkzYTJiZDBhZWU1ZTBmYWIiLCJhY3RpdmVQbGFuIjoiQkFTSUNfTU9OVEhMWSIsImlhdCI6MTcxNDIwMDI2N30.fQE69zoffweW2Z4_pMiXynoJjextT5jLrhXp6Bh1FgQ",
    campaignName: "kyc_incomplete",
    destination: phoneNumber,
    userName: "Hailgro tech solutions pvt. ltd.",
    media: {
      url: "https://s3.eu-north-1.amazonaws.com/copartners-storage/Images/IMG_0698.jpg",
      filename: "kycIncomplete",
    },
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Error:", error);
  }
};

router.get("/getChannelData", async (req, res) => {
  try {
    const channels = await ChatMember.aggregate([
      {
        $project: {
          chatId: 1,
          channelName: 1,
          links: { $setUnion: "$members.chatLink" },
        },
      },
    ]);

    res.json(channels);
  } catch (error) {
    console.error("Error fetching channel data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/getJoinBotData", async (req, res) => {
  try {
    const channels = await JoinBot.aggregate([
      {
        $lookup: {
          from: "chatmembers",
          localField: "chatId",
          foreignField: "chatId",
          as: "chatMembers",
        },
      },
      {
        $unwind: {
          path: "$chatMembers",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $addFields: {
          telegramLinks: { $ifNull: ["$telegramLinks", []] },
          linksWithCounts: {
            $map: {
              input: "$telegramLinks",
              as: "link",
              in: {
                link: "$$link",
                membersCount: {
                  $size: {
                    $filter: {
                      input: "$chatMembers.members",
                      as: "member",
                      cond: { $eq: ["$$member.chatLink", "$$link"] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      {
        $project: {
          chatId: 1,
          channelName: 1,
          linksWithCounts: 1,
        },
      },
    ]);

    res.json(channels);
  } catch (error) {
    console.error("Error fetching join bot data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/update-member", async (req, res) => {
  const { inviteLink, memberId } = req.body;

  if (!inviteLink || !memberId) {
    return res
      .status(400)
      .json({ message: "inviteLink and memberId are required" });
  }

  try {
    const chat = await Chat.findOneAndUpdate(
      { "inviteLinks.inviteLink": inviteLink },
      { $set: { "inviteLinks.$.memberId": memberId } },
      { new: true }
    );

    if (!chat) {
      return res.status(404).json({ message: "Invite link not found" });
    }

    res.status(200).json({ message: "Member ID updated successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
});

router.get("/getLink", async (req, res) => {
  const { inviteLink } = req.body;
  try {
    if (!inviteLink) {
      return res
        .status(400)
        .json({ message: "inviteLink query parameter is required" });
    }

    const documents = await Chat.find(
      { "inviteLinks.inviteLink": inviteLink },
      { "inviteLinks.$": 1 }
    );

    if (documents.length === 0) {
      return res
        .status(404)
        .json({ message: "No document found with the given inviteLink" });
    }

    const filteredLinks = documents.map((doc) =>
      doc.inviteLinks.find((link) => link.inviteLink === inviteLink)
    );

    res.status(200).json(filteredLinks);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/createInviteLink", async (req, res) => {
  const { chatId, durationMonths, isCustom, userId, mobileNumber } = req.query;
  try {
    const result = await createInviteLink(
      chatId,
      durationMonths,
      isCustom,
      userId,
      mobileNumber
    );
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const sendSMS = async (mobileNumber, inviteLink) => {
  try {
    const inviteCode = encodeURIComponent(inviteLink.split("https://t.me/")[1]);

    if (!inviteCode) {
      throw new Error("Invalid invite link format");
    }

    const response = await fetch(
      `https://www.fast2sms.com/dev/bulkV2?authorization=${key}&route=dlt&sender_id=${senderId}&message=169464&variables_values=${inviteCode}&flash=0&numbers=${mobileNumber}`
    );
    if (response.ok) {
      console.log(
        `SMS sent to mobile ${mobileNumber} with invite link ${inviteCode}`
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
      isCustom
    } = req.body;

    const options = {
      amount: totalAmount * 100, // Convert to paise
      currency: "INR",
      receipt: transactionId,
      payment_capture: '1', // Auto capture after payment
      notes: {
        transactionId,
        returnUrl,
        planType: plan,
        chatId,
        subscriptionId,
        userId,
        totalAmount,
        mobileNumber,
        transactionDate,
        isCustom,
      }
    };

    const order = await razorpayInstance.orders.create(options);

    const data = {
      orderId: order.id,
      amountInPaise: order.amount,
      currency: order.currency,
      method: order.method
    };

    console.log("/pay block", data);
    res.json(data);
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    res.status(500).send(error.message);
  }
});

router.post("/payment/callback", async (req, res) => {
  try {
    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      method
    } = req.body;

    console.log("req.body", req.body);

    const order = await razorpayInstance.orders.fetch(razorpay_order_id);

    const {
      transactionId,
      returnUrl,
      planType,
      chatId,
      subscriptionId,
      userId,
      totalAmount,
      mobileNumber,
      transactionDate,
      isCustom,
    } = order.notes;

    console.log("req.query", order.notes);

    // Verify the payment signature
    const generated_signature = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (generated_signature !== razorpay_signature) {
      throw new Error("Invalid Razorpay signature");
    }

    // Proceed if the payment is successful and verified
    try {
      const paymentMode = "Razorpay"; // As Razorpay doesn't specify a mode in the response

      const result = await createInviteLink(chatId, planType, isCustom, userId, mobileNumber);
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
        result.inviteLink,
        mobileNumber
      );
      if (!subscriber.isSuccess) {
        throw new Error("Failed to POST subscriber API");
      }

      const subscriberId = subscriber.data.id;

      // const isKYC = await userKYC(userId);
      // if (isKYC) {
      //   await sendPaidTelegramLinkMessage(mobileNumber, result.inviteLink);
      //   await sendSMS(mobileNumber, result.inviteLink);
      // } else {
      //   sendPostRequest(mobileNumber);
      // }
      console.log(result.inviteLink, chatId);

      // await postPaymentResponse({
      //   subscriptionId,
      //   userId,
      //   transactionId,
      //   status: "S",
      //   amount: totalAmount,
      //   paymentMode,
      //   transactionDate,
      //   remarks: "Payment successful",
      // });

      // Redirect to KYC page after successful payment
      return res.json({
        success: true,
        redirectUrl: `http://localhost:3000/kycpage?status=success&transactionId=${transactionId}&inviteLink=${encodeURIComponent(
          result.inviteLink
        )}&planType=${planType}&amount=${totalAmount}&subscriptionId=${subscriptionId}&subscriberId=${subscriberId}`
      });
    } catch (error) {
      console.error("Error while processing payment:", error);
      return res.status(500).json({ error: error.message });
    }
  } catch (error) {
    console.error("Error in payment callback:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/getChatNames", async (req, res) => {
  try {
    const chatNames = await ChatName.find()
      .select("chatId chatName createdAt")
      .lean();
    res.json(chatNames);
  } catch (error) {
    console.error("Failed to fetch chat names:", error);
    res.status(500).json({ message: "Failed to retrieve chat names" });
  }
});

async function postPaymentResponse(data) {
  try {
    await axios.post("https://copartners.in:5009/api/PaymentResponse", data, {
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Error posting payment response:", error);
  }
}

const userKYC = async (userId) => {
  try {
    const response = await fetch(
      `https://copartners.in:5131/api/User/${userId}`
    );
    if (!response.ok) {
      throw new Error("Failed to fetch user data");
    }
    const data = await response.json();
    return data.data.isKYC;
  } catch (error) {
    console.error("Error fetching user KYC data:", error.message);
    return null;
  }
};

const postSubscriberData = async (
  transactionId,
  subscriptionId,
  userId,
  totalAmount,
  paymentMode,
  transactionDate,
  premiumTelegramChannel,
  mobileNumber
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
    mobileNumber,
  };

  try {
    const response = await axios.post(
      "https://copartners.in:5009/api/Subscriber/TempSubscription",
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

const revokeInviteLinkAndBanMember = async (
  chatId,
  memberId,
  inviteLink,
  inviteLinkRecord,
  existingChat
) => {
  try {
    const [revokeResponse, banResponse] = await Promise.all([
      fetch(
        `https://api.telegram.org/bot${token}/revokeChatInviteLink`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, invite_link: inviteLink }),
        }
      ),
      fetch(
        `https://api.telegram.org/bot${token}/unbanChatMember`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, user_id: memberId }),
        }
      ),
    ]);

    const revokeData = await revokeResponse.json();
    const banData = await banResponse.json();

    if (revokeData.ok && banData.ok) {
      console.log("Invite link revoked and member banned:", inviteLink);

      // Update the invite link status to "removed"
      inviteLinkRecord.status = "removed";

      // Optionally, update other fields if necessary
      inviteLinkRecord.expirationDate = new Date();

      // Save the updated Chat document
      await existingChat.save();
    } else {
      if (!banData.ok) {
        throw new Error(`Failed to ban member: ${banData.description}`);
      }
      if (!revokeData.ok) {
        throw new Error(
          `Failed to revoke invite link: ${revokeData.description}`
        );
      }
    }
  } catch (error) {
    console.error("Error during revocation and member removal process:", error);
    throw error;
  }
};

// API endpoint to revoke invite link and ban member
router.post("/revokeInviteLink", async (req, res) => {
  const { chatId, inviteChatLink, memberId } = req.body;

  // Validate input
  if (!chatId || !inviteChatLink) {
    return res.status(400).json({
      error: "Missing required parameters: chatId, inviteChatLink, memberId",
    });
  }

  try {
    // Retrieve the Chat document
    const existingChat = await Chat.findOne({ inviteChatLink });

    if (!existingChat) {
      return res.status(404).json({ error: "Chat not found." });
    }

    // Find the specific invite link record
    const inviteLinkRecord = existingChat.inviteLinks.find(
      (link) => link.inviteLink === inviteChatLink
    );

    if (!inviteLinkRecord) {
      return res
        .status(404)
        .json({ error: "Invite link not found in the specified chat." });
    }

    if (inviteLinkRecord.status === "removed") {
      return res
        .status(400)
        .json({ error: "Invite link is already removed." });
    }

    // Revoke invite link and ban member
    await revokeInviteLinkAndBanMember(
      chatId,
      memberId,
      inviteChatLink,
      inviteLinkRecord,
      existingChat
    );

    res.json({
      message: "Invite link revoked and member banned successfully.",
    });
  } catch (error) {
    console.error("Error in /revokeInviteLink endpoint:", error);
    res.status(500).json({ error: error.message });
  }
});

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

// THESE ARE ALL THE API'S FOR WHATSAPP API

//https://s3.eu-north-1.amazonaws.com/copartners-storage/IMAGES/Joining from copartner-01.jpg

router.get("/sendSignup", async (req, res) => {
  // const { phone, discount, name, channel, exp, foll, raid } = req.query;
  const { phone } = req.query;
  try {
    const response = await fetchSubscriptionData();
    res.status(200).json({ success: true, data: response });
  } catch (error) {
    console.log(error.message);
    res.status(500).json("Some error in the api");
  }
});

const sendTwoHourGapMessage = async (phoneNumber) => {
  const url = "https://backend.aisensy.com/campaign/t1/api/v2";
  const data = {
    apiKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2MmM5ZWNiOTNhMmJkMGFlZTVlMGZiMiIsIm5hbWUiOiJIYWlsZ3JvIHRlY2ggc29sdXRpb25zIHB2dC4gbHRkLiIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2NjJjOWVjYjkzYTJiZDBhZWU1ZTBmYWIiLCJhY3RpdmVQbGFuIjoiQkFTSUNfTU9OVEhMWSIsImlhdCI6MTcxNDIwMDI2N30.fQE69zoffweW2Z4_pMiXynoJjextT5jLrhXp6Bh1FgQ",
    campaignName: "new_signup_2hourgap (After 2 Hours) (IMAGE)",
    destination: phoneNumber,
    userName: "Hailgro tech solutions pvt. ltd.",
    templateParams: [],
    source: "new-landing-page form",
    media: {
      url: "https://s3.eu-north-1.amazonaws.com/copartners-storage/IMAGES/RA%20Post%203-02%20(1).jpg",
      filename: "sample_media",
    },
    buttons: [],
    carouselCards: [],
    location: {},
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    return response;
  } catch (error) {
    console.error("Error:", error);
  }
};

const sentUsersPath = path.resolve(__dirname, "sentUsers.json"); // File to store sent user IDs

// Function to read sent user IDs from file
const getSentUserIds = () => {
  try {
    const data = fs.readFileSync(sentUsersPath, "utf8");
    return new Set(JSON.parse(data));
  } catch (error) {
    console.error("Error reading sent users file:", error);
    return new Set();
  }
};

// Function to append a sent user ID to file
const markUserAsSent = (userId) => {
  const sentUserIds = Array.from(getSentUserIds());
  sentUserIds.push(userId);
  fs.writeFileSync(sentUsersPath, JSON.stringify(sentUserIds), "utf8");
};

const fetchTwoHourUserData = async () => {
  console.log("sendTwoHourGapMessage");
  const url =
    "https://copartners.in:5134/api/UserData/UserDataListing?page=1&pageSize=100000";
  const sentUserIds = getSentUserIds();

  try {
    const response = await axios.get(url, {
      headers: { "Content-Type": "application/json" },
    });

    const targetUsers = response.data.data.filter((user) => {
      const userCreationTime = moment(user.date);
      const timeDiff = moment().diff(userCreationTime, "hours", true);
      return timeDiff >= 1.75 && timeDiff <= 2 && !sentUserIds.has(user.userId);
    });

    for (let user of targetUsers) {
      await sendTwoHourGapMessage(user.mobile);
      markUserAsSent(user.userId);
    }
    console.log(`Messages sent to ${targetUsers.length} users.`);
  } catch (error) {
    console.error("Error fetching user data:", error);
  }
};

// Schedule task to run every 10 minutes
cron.schedule("*/10 * * * *", fetchTwoHourUserData);

const signedUser2Discount = async (
  discount,
  expertName,
  channelName,
  experience,
  followers,
  raid,
  phoneNumber,
  raImage
) => {
  const url = "https://backend.aisensy.com/campaign/t1/api/v2";
  const data = {
    apiKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2MmM5ZWNiOTNhMmJkMGFlZTVlMGZiMiIsIm5hbWUiOiJIYWlsZ3JvIHRlY2ggc29sdXRpb25zIHB2dC4gbHRkLiIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2NjJjOWVjYjkzYTJiZDBhZWU1ZTBmYWIiLCJhY3RpdmVQbGFuIjoiQkFTSUNfTU9OVEhMWSIsImlhdCI6MTcxNDIwMDI2N30.fQE69zoffweW2Z4_pMiXynoJjextT5jLrhXp6Bh1FgQ",
    campaignName: "signed_user_4_discount (Sunday 5PM) (Upto 2) (IMAGE)",
    destination: phoneNumber,
    userName: "Hailgro tech solutions pvt. ltd.",
    templateParams: [
      `${discount}`,
      `${expertName}`,
      `${channelName}`,
      `${experience}`,
      `${followers}`,
      `https://copartner.in/ra-detail/${raid}`,
    ],
    source: "new-landing-page form",
    media: {
      url: raImage,
      filename: "sample_media",
    },
    buttons: [],
    carouselCards: [],
    location: {},
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Error:", error);
  }
};

const fetchSubscriptionData = async () => {
  const url = "https://copartners.in:5009/api/Subscription";
  try {
    const response = await axios.get(url, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    const subscriptions = response.data.data;
    const filteredSubscriptions = subscriptions
      .filter((sub) => sub.discountPercentage && !sub.isSpecialSubscription)
      .sort(
        (a, b) => new Date(b.discountValidFrom) - new Date(a.discountValidFrom)
      );
    return filteredSubscriptions;
  } catch (error) {
    console.error("Error fetching subscription data:", error);
    return [];
  }
};

const fetchUserData = async () => {
  const url =
    "https://copartners.in:5134/api/UserData/UserDataListing?page=1&pageSize=100000";
  try {
    const response = await axios.get(url, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    return response.data.data;
  } catch (error) {
    console.error("Error fetching user data:", error);
    return [];
  }
};

// Schedule the task to run at two times on Sunday
// cron.schedule("30 3 * * 0", async () => {
//   console.log("signedUser2Discount 9 AM Sunday IST");
//   const subscriptions = await fetchSubscriptionData();
//   const users = await fetchUserData();

//   if (subscriptions.length > 0 && users.length > 0) {
//     for (const subscription of subscriptions) {
//       for (const user of users) {
//         await signedUser2Discount(
//           subscription.discountPercentage,
//           subscription.experts.name,
//           subscription.experts.channelName,
//           subscription.experts.experience,
//           subscription.experts.telegramFollower,
//           subscription.expertsId,
//           user.mobile,
//           subscription.experts.expertImagePath
//         );
//       }
//     }
//   } else {
//     console.log("No subscriptions or users found.");
//   }
// });

cron.schedule("30 11 * * 0", async () => {
  console.log("signedUser2Discount 5 PM Sunday IST");
  const subscriptions = await fetchSubscriptionData();
  const users = await fetchUserData();

  if (subscriptions.length > 0 && users.length > 0) {
    for (const subscription of subscriptions) {
      for (const user of users) {
        try {
          console.log(
            `Processing discount for user: ${user.mobile} and subscription: ${subscription.experts.name}`
          );
          await signedUser2Discount(
            subscription.discountPercentage,
            subscription.experts.name,
            subscription.experts.channelName,
            subscription.experts.experience,
            subscription.experts.telegramFollower,
            subscription.expertsId,
            user.mobile,
            subscription.experts.expertImagePath
          );
        } catch (error) {
          console.error(
            `Error processing discount for user: ${user.mobile}`,
            error
          );
        }
      }
    }
  } else {
    console.log("No subscriptions or users found.");
  }
});

const sendPaidTelegramLinkMessage = async (phoneNumber, link) => {
  const url = "https://backend.aisensy.com/campaign/t1/api/v2";
  const data = {
    apiKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2MmM5ZWNiOTNhMmJkMGFlZTVlMGZiMiIsIm5hbWUiOiJIYWlsZ3JvIHRlY2ggc29sdXRpb25zIHB2dC4gbHRkLiIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2NjJjOWVjYjkzYTJiZDBhZWU1ZTBmYWIiLCJhY3RpdmVQbGFuIjoiQkFTSUNfTU9OVEhMWSIsImlhdCI6MTcxNDIwMDI2N30.fQE69zoffweW2Z4_pMiXynoJjextT5jLrhXp6Bh1FgQ",
    campaignName:
      "⁠⁠paid_telegram_link (Upon KYC completion) (TEXT)",
    destination: phoneNumber,
    userName: "Hailgro tech solutions pvt. ltd.",
    templateParams: [link],
    source: "new-landing-page form",
    media: {
      url: "https://whatsapp-media-library.s3.ap-south-1.amazonaws.com/IMAGE/6353da2e153a147b991dd812/5442184_confidentmansuit.png",
      filename: "sample_media",
    },
    buttons: [],
    carouselCards: [],
    location: {},
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    return response;
  } catch (error) {
    console.error("Error:", error);
  }
};

const sendFriday1030amMessage = async (phoneNumber, userName, raName) => {
  const url = "https://backend.aisensy.com/campaign/t1/api/v2";
  const data = {
    apiKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2MmM5ZWNiOTNhMmJkMGFlZTVlMGZiMiIsIm5hbWUiOiJIYWlsZ3JvIHRlY2ggc29sdXRpb25zIHB2dC4gbHRkLiIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2NjJjOWVjYjkzYTJiZDBhZWU1ZTBmYWIiLCJhY3RpdmVQbGFuIjoiQkFTSUNfTU9OVEhMWSIsImlhdCI6MTcxNDIwMDI2N30.fQE69zoffweW2Z4_pMiXynoJjextT5jLrhXp6Bh1FgQ",
    campaignName:
      "⁠⁠paid_user_friday_1030am_3 (FRIDAY 10:30AM - ACCORDING TO PAID RA) (IMAGE)",
    destination: phoneNumber,
    userName: "Hailgro tech solutions pvt. ltd.",
    templateParams: [userName, raName],
    source: "new-landing-page form",
    media: {
      url: "https://whatsapp-media-library.s3.ap-south-1.amazonaws.com/IMAGE/6353da2e153a147b991dd812/5442184_confidentmansuit.png",
      filename: "sample_media",
    },
    buttons: [],
    carouselCards: [],
    location: {},
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    console.log(`Campaign sent to ${phoneNumber}`);
  } catch (error) {
    console.error(`Error sending campaign to ${phoneNumber}:`, error);
  }
};

const fetchRaName = async (raSubscriber) => {
  const url = `https://copartners.in:5132/api/Experts/${raSubscriber}`;
  try {
    const response = await axios.get(url, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    return response.data.data.name;
  } catch (error) {
    console.error(`Error fetching RA name for ${raSubscriber}:`, error);
    return "";
  }
};

const sendCampaignsToEligibleUsers = async () => {
  const firstTimeUsers = await fetchDynamicUrlUsers(
    "https://copartners.in:5134/api/UserData/UserFirstTimePaymentListing?page=1&pageSize=100000"
  );
  const secondTimeUsers = await fetchDynamicUrlUsers(
    "https://copartners.in:5134/api/UserData/UserSecondTimePaymentListing?page=1&pageSize=100000"
  );

  const allUsers = [...firstTimeUsers, ...secondTimeUsers];

  for (const user of allUsers) {
    if (user.mobile && user.name && user.raSubscriber) {
      const raName = await fetchRaName(user.raSubscriber);
      await sendFriday1030amMessage(user.mobile, user.name, raName);
      // console.log(user.mobile, user.name, raName )
    }
  }
};

cron.schedule("0 14 * * 1", async () => {
  console.log("Running sendCampaignsToEligibleUsers at Monday 2 PM...");
  await sendCampaignsToEligibleUsers();
});

const sendDiscount4Message = async (
  discount,
  expertName,
  channelName,
  experience,
  followers,
  raid,
  phoneNumber,
  raImage
) => {
  const url = "https://backend.aisensy.com/campaign/t1/api/v2";
  const data = {
    apiKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2MmM5ZWNiOTNhMmJkMGFlZTVlMGZiMiIsIm5hbWUiOiJIYWlsZ3JvIHRlY2ggc29sdXRpb25zIHB2dC4gbHRkLiIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2NjJjOWVjYjkzYTJiZDBhZWU1ZTBmYWIiLCJhY3RpdmVQbGFuIjoiQkFTSUNfTU9OVEhMWSIsImlhdCI6MTcxNDIwMDI2N30.fQE69zoffweW2Z4_pMiXynoJjextT5jLrhXp6Bh1FgQ",
    campaignName:
      "signed_user_2_discount (FRIDAY -1PM TO 10PM UPTO 2 ON OTHER THAN PAID RA PROVIDING DISCOUNT) (IMAGE)",
    destination: phoneNumber,
    userName: "Hailgro tech solutions pvt. ltd.",
    templateParams: [
      `${discount}`,
      `${expertName}`,
      `${channelName}`,
      `${experience}`,
      `${followers}`,
      `https://copartner.in/ra-detail/${raid}`,
    ],
    source: "new-landing-page form",
    media: {
      url: raImage,
      filename: "sample_media",
    },
    buttons: [],
    carouselCards: [],
    location: {},
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Error:", error);
  }
};

const checkAndSendDiscountMessages = async () => {
  try {
    const userResponse = await axios.get(
      "https://copartners.in:5134/api/UserData/UserFirstTimePaymentListing?page=1&pageSize=100000"
    );

    const subscriptions = await fetchSubscriptionData();
    const users = userResponse.data.data;

    if (subscriptions.length > 0) {
      for (const subscription of subscriptions) {
        if (subscription.discountedAmount && subscription.expertsId) {
          for (const user of users) {
            if (user.raSubscriber !== subscription.expertsId) {
              // Send discount message to the user
              await sendDiscount4Message(
                subscription.discountedAmount,
                subscription.experts.name,
                subscription.experts.channelName,
                subscription.experts.experience,
                subscription.experts.telegramFollower,
                subscription.expertsId,
                user.mobile,
                subscription.experts.expertImagePath
              );
            }
          }
        }
      }
    } else console.log("No Discounts");
  } catch (error) {
    console.error("Error fetching data:", error);
  }
};

cron.schedule("0 10,17 * * 5", () => {
  console.log("sendDiscount4Message 10 AM and 5 PM Friday");
  checkAndSendDiscountMessages();
});

const sunday11PM = async (phoneNumber) => {
  const url = "https://backend.aisensy.com/campaign/t1/api/v2";
  const data = {
    apiKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2MmM5ZWNiOTNhMmJkMGFlZTVlMGZiMiIsIm5hbWUiOiJIYWlsZ3JvIHRlY2ggc29sdXRpb25zIHB2dC4gbHRkLiIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2NjJjOWVjYjkzYTJiZDBhZWU1ZTBmYWIiLCJhY3RpdmVQbGFuIjoiQkFTSUNfTU9OVEhMWSIsImlhdCI6MTcxNDIwMDI2N30.fQE69zoffweW2Z4_pMiXynoJjextT5jLrhXp6Bh1FgQ",
    campaignName: "updated⁠⁠new_signed_user_sunday_11am",
    destination: phoneNumber,
    userName: "Hailgro tech solutions pvt. ltd.",
    templateParams: [],
    source: "new-landing-page form",
    media: {},
    buttons: [],
    carouselCards: [],
    location: {},
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Error:", error);
  }
};

const processUsersForSunday11PM = async () => {
  const users = await fetchUserData();

  for (const user of users) {
    await sunday11PM(user.mobile);
  }
};

// Schedule the cron job to run every Sunday at 11 AM
cron.schedule("30 5 * * 0", () => {
  console.log("WhatsApp campaign sunday11PM 11 AM IST");
  processUsersForSunday11PM();
});

const sunday8PM = async (phoneNumber) => {
  const url = "https://backend.aisensy.com/campaign/t1/api/v2";
  const data = {
    apiKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2MmM5ZWNiOTNhMmJkMGFlZTVlMGZiMiIsIm5hbWUiOiJIYWlsZ3JvIHRlY2ggc29sdXRpb25zIHB2dC4gbHRkLiIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2NjJjOWVjYjkzYTJiZDBhZWU1ZTBmYWIiLCJhY3RpdmVQbGFuIjoiQkFTSUNfTU9OVEhMWSIsImlhdCI6MTcxNDIwMDI2N30.fQE69zoffweW2Z4_pMiXynoJjextT5jLrhXp6Bh1FgQ",
    campaignName: "updatedsunday8pm_singed_telegram_link[SUNDAY 8 PM](IMAGE)",
    destination: phoneNumber,
    userName: "Hailgro tech solutions pvt. ltd.",
    templateParams: [],
    source: "new-landing-page form",
    media: {},
    buttons: [],
    carouselCards: [],
    location: {},
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    return response;
  } catch (error) {
    console.error("Error:", error);
  }
};

const processUsersForsunday8PM = async () => {
  const users = await fetchUserData();

  for (const user of users) {
    await sunday8PM(user.mobile);
  }
};

// Schedule the cron job to run every Sunday at 8 PM
cron.schedule("0 20 * * 0", () => {
  console.log("WhatsApp campaign sunday8PM 8 PM");
  processUsersForsunday8PM();
});

async function signeduser97Sunday2PM(phone) {
  const payload = {
    apiKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2MmM5ZWNiOTNhMmJkMGFlZTVlMGZiMiIsIm5hbWUiOiJIYWlsZ3JvIHRlY2ggc29sdXRpb25zIHB2dC4gbHRkLiIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2NjJjOWVjYjkzYTJiZDBhZWU1ZTBmYWIiLCJhY3RpdmVQbGFuIjoiQkFTSUNfTU9OVEhMWSIsImlhdCI6MTcxNDIwMDI2N30.fQE69zoffweW2Z4_pMiXynoJjextT5jLrhXp6Bh1FgQ",
    campaignName: "97signeduser1(IMAGE)( MONDAY 2 PM FOR SIGNED USERS)",
    destination: phone,
    userName: "Hailgro tech solutions pvt. ltd.",
    templateParams: [],
    source: "new-landing-page form",
    media: {
      url: "https://s3.eu-north-1.amazonaws.com/copartners-storage/CAMPAIGN/Offer%20%20post%20-03-01.jpg",
      filename: "sample_media",
    },
    buttons: [],
    carouselCards: [],
    location: {},
  };

  try {
    const response = await axios.post(
      "https://backend.aisensy.com/campaign/t1/api/v2",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error sending campaign:", error);
  }
}

cron.schedule("0 14 * * 0", async () => {
  console.log("signeduser97Sunday2PM");
  const users = await fetchUserData();
  for (const user of users) {
    await signeduser97Sunday2PM(user.mobile);
  }
});

async function after97plan2daysover(phone) {
  const url = "https://backend.aisensy.com/campaign/t1/api/v2";
  const data = {
    apiKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2MmM5ZWNiOTNhMmJkMGFlZTVlMGZiMiIsIm5hbWUiOiJIYWlsZ3JvIHRlY2ggc29sdXRpb25zIHB2dC4gbHRkLiIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2NjJjOWVjYjkzYTJiZDBhZWU1ZTBmYWIiLCJhY3RpdmVQbGFuIjoiQkFTSUNfTU9OVEhMWSIsImlhdCI6MTcxNDIwMDI2N30.fQE69zoffweW2Z4_pMiXynoJjextT5jLrhXp6Bh1FgQ",
    campaignName:
      "after97plan2daysover_1 (TEXT) (AFTER 97 PAID USER PLAN GETS OVER)",
    destination: phone,
    userName: "Hailgro tech solutions pvt. ltd.",
    templateParams: [],
    source: "new-landing-page form",
    media: {
      url: "https://whatsapp-media-library.s3.ap-south-1.amazonaws.com/IMAGE/6353da2e153a147b991dd812/4958901_highanglekidcheatingschooltestmin.jpg",
      filename: "sample_media",
    },
    buttons: [],
    carouselCards: [],
    location: {},
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
}

const fetchDynamicUrlUsers = async (url) => {
  try {
    const response = await axios.get(url, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    return response.data.data;
  } catch (error) {
    console.error(`Error fetching user data from ${url}:`, error);
    return [];
  }
};

const filterEligibleUsers = (users) => {
  const now = new Date();
  return users.filter((user) => {
    if (!user.isSpecialSubscription) return false;
    const userDate = new Date(user.date);
    const timeDifference = now - userDate;
    const daysDifference = timeDifference / (1000 * 60 * 60 * 24);
    return daysDifference > 2 && daysDifference < 3;
  });
};

// Schedule the task to run daily at 2 PM
cron.schedule("0 14 * * *", async () => {
  console.log("after97plan2daysover");
  const firstTimeUsers = await fetchDynamicUrlUsers(
    "https://copartners.in:5134/api/UserData/UserFirstTimePaymentListing?page=1&pageSize=1000000"
  );
  const secondTimeUsers = await fetchDynamicUrlUsers(
    "https://copartners.in:5134/api/UserData/UserSecondTimePaymentListing?page=1&pageSize=1000000"
  );

  const allUsers = [...firstTimeUsers, ...secondTimeUsers];
  const eligibleUsers = filterEligibleUsers(allUsers);

  for (const user of eligibleUsers) {
    await after97plan2daysover(user.mobile);
  }
});

async function userdiscount97(phone) {
  const url = "https://backend.aisensy.com/campaign/t1/api/v2";
  const data = {
    apiKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2MmM5ZWNiOTNhMmJkMGFlZTVlMGZiMiIsIm5hbWUiOiJIYWlsZ3JvIHRlY2ggc29sdXRpb25zIHB2dC4gbHRkLiIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2NjJjOWVjYjkzYTJiZDBhZWU1ZTBmYWIiLCJhY3RpdmVQbGFuIjoiQkFTSUNfTU9OVEhMWSIsImlhdCI6MTcxNDIwMDI2N30.fQE69zoffweW2Z4_pMiXynoJjextT5jLrhXp6Bh1FgQ",
    campaignName:
      "97userdiscount2(Message to be send after after97plan2daysover_1 )",
    destination: phone,
    userName: "Hailgro tech solutions pvt. ltd.",
    templateParams: [
      "$sample1",
      "$sample2",
      "$sample3",
      "$sample4",
      "$sample5",
      "$sample6",
    ],
    source: "new-landing-page form",
    media: {
      url: "https://whatsapp-media-library.s3.ap-south-1.amazonaws.com/IMAGE/6353da2e153a147b991dd812/4958901_highanglekidcheatingschooltestmin.jpg",
      filename: "sample_media",
    },
    buttons: [],
    carouselCards: [],
    location: {},
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
}

async function renewal_reminder1(phone) {
  const url = "https://backend.aisensy.com/campaign/t1/api/v2";
  const data = {
    apiKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2MmM5ZWNiOTNhMmJkMGFlZTVlMGZiMiIsIm5hbWUiOiJIYWlsZ3JvIHRlY2ggc29sdXRpb25zIHB2dC4gbHRkLiIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2NjJjOWVjYjkzYTJiZDBhZWU1ZTBmYWIiLCJhY3RpdmVQbGFuIjoiQkFTSUNfTU9OVEhMWSIsImlhdCI6MTcxNDIwMDI2N30.fQE69zoffweW2Z4_pMiXynoJjextT5jLrhXp6Bh1FgQ",
    campaignName:
      "97userdiscount2(Message to be send after after97plan2daysover_1 )",
    destination: phone,
    userName: "Hailgro tech solutions pvt. ltd.",
    templateParams: [
      "$sample1",
      "$sample2",
      "$sample3",
      "$sample4",
      "$sample5",
      "$sample6",
    ],
    source: "new-landing-page form",
    media: {
      url: "https://whatsapp-media-library.s3.ap-south-1.amazonaws.com/IMAGE/6353da2e153a147b991dd812/4958901_highanglekidcheatingschooltestmin.jpg",
      filename: "sample_media",
    },
    buttons: [],
    carouselCards: [],
    location: {},
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
}

async function incomplete_payment(phone) {
  const url = "https://backend.aisensy.com/campaign/t1/api/v2";
  const data = {
    apiKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2MmM5ZWNiOTNhMmJkMGFlZTVlMGZiMiIsIm5hbWUiOiJIYWlsZ3JvIHRlY2ggc29sdXRpb25zIHB2dC4gbHRkLiIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2NjJjOWVjYjkzYTJiZDBhZWU1ZTBmYWIiLCJhY3RpdmVQbGFuIjoiQkFTSUNfTU9OVEhMWSIsImlhdCI6MTcxNDIwMDI2N30.fQE69zoffweW2Z4_pMiXynoJjextT5jLrhXp6Bh1FgQ",
    campaignName:
      "⁠incomplete_payment (TEXT) (TO BE SENT TO USER WHO TRIED TO PAY AND THE PAYMENT WAS NOT COMPLETED WITHIN 5 MINUTES)",
    destination: phone,
    userName: "Hailgro tech solutions pvt. ltd.",
    templateParams: ["$sample1"],
    source: "new-landing-page form",
    media: {},
    buttons: [],
    carouselCards: [],
    location: {},
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
}

module.exports = router;
