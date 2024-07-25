const express = require("express");
const fetch = require("node-fetch");
const { Chat } = require("../models/UserSchema");
const axios = require("axios");
const cron = require("node-cron");
const sha256 = require("sha256");
const { ChatName } = require("../models/ChatNameSchema");
const { message } = require("telegraf/filters");
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

    let expirationDate;
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 for Sunday, 1 for Monday, ..., 5 for Friday, 6 for Saturday
    const currentTime = now.getHours() * 60 + now.getMinutes(); // Current time in minutes
    const fridayTimeLimit = 15 * 60 + 30; // 3:30 PM in minutes
    const sundayTimeLimit = 15 * 60 + 30; // 3:30 PM in minutes

    if (!isDays || isDays === "false") {
      expirationDate = new Date(
        Date.now() + durationMonths * 30 * 24 * 60 * 60 * 1000
      );
    } else {
      let additionalDays = 0;
      if (dayOfWeek === 5 && currentTime > fridayTimeLimit) {
        additionalDays = 3;
      } else if (dayOfWeek === 6) {
        additionalDays = 2;
      } else if (dayOfWeek === 0 && currentTime < sundayTimeLimit) {
        additionalDays = 1;
      }

      expirationDate = new Date(
        Date.now() +
          (durationMonths * 24 * 60 * 60 * 1000) +
          additionalDays * 24 * 60 * 60 * 1000
      );
    }

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
    console.log("Response:", response.data);
  } catch (error) {
    console.error("Error:", error);
  }
};

router.put("/update-member", async (req, res) => {
  const { inviteLink, memberId } = req.body;

  if (!inviteLink || !memberId) {
    return res.status(400).json({ message: "inviteLink and memberId are required" });
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
      isCustom,
    } = req.body;
    const data = {
      merchantId: MERCHANT_ID,
      merchantTransactionId: transactionId,
      amount: totalAmount * 100,
      redirectUrl: `${APP_BE_URL}/api/payment/callback?id=${transactionId}&returnUrl=${encodeURIComponent(
        returnUrl
      )}&planType=${plan}&chatId=${chatId}&subscriptionId=${subscriptionId}&userId=${userId}&totalAmount=${totalAmount}&mobileNumber=${mobileNumber}&transactionDate=${transactionDate}&isCustom=${isCustom}`,
      redirectMode: "POST",
      merchantUserId: userId,
      paymentInstrument: {
        type: "PAY_PAGE",
      },
    };
    console.log("/pay block", data);
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

async function checkPayment(req, res) {
  try {
    const { transactionId } = req.query;

    console.log("req.query", transactionId);

    if (!transactionId) {
      throw new Error("Cannot find Merchant Transaction ID");
    }

    const statusUrl = `${PHONE_PE_HOST_URL}/pg/v1/status/${MERCHANT_ID}/${transactionId}`;
    const string = `/pg/v1/status/${MERCHANT_ID}/${transactionId}${SALT_KEY}`;
    const sha256_val = sha256(string).toString();
    const xVerifyChecksum = `${sha256_val}###${SALT_INDEX}`;

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
    const data = response.data;

    // Handle the response data according to your business logic
    // For example, update the payment status in your database

    res.status(200).json({
      message: "Payment status retrieved successfully",
      data,
    });
  } catch (error) {
    console.error("Error in /checkpayment:", error.message);
    res.status(500).json({
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

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
      isCustom,
    } = req.query;
    console.log(
      "req.query",
      transactionId,
      subscriptionId,
      userId,
      totalAmount,
      mobileNumber
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
    const paymentStatus = response.data.data.responseCode;
    if (response.data.success && paymentStatus === "SUCCESS") {
      try {
        const paymentMode = response.data.data.paymentInstrument.type;
        const result = await createInviteLink(
          chatId,
          planType,
          isCustom,
          userId,
          mobileNumber
        );
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

        const isKYC = await userKYC(userId);
        if (isKYC) {
          await sendPaidTelegramLinkMessage(mobileNumber, result.inviteLink);
          await sendSMS(mobileNumber, result.inviteLink);
        } else {
          sendPostRequest(mobileNumber);
        }
        console.log(result.inviteLink, chatId);

        await postPaymentResponse({
          subscriptionId,
          userId,
          transactionId,
          status: "S",
          amount: totalAmount,
          paymentMode,
          transactionDate,
          remarks: "Payment successful",
        });

        return res.redirect(
          `https://copartner.in/kycpage?status=success&transactionId=${transactionId}&inviteLink=${encodeURIComponent(
            result.inviteLink
          )}&planType=${planType}&amount=${totalAmount}&subscriptionId=${subscriptionId}`
        );
      } catch (error) {
        console.error("Error while creating invite link:", error);
        return res.status(500).json({ error: error.message });
      }
    } else if (response.data.success && paymentStatus === "PENDING") {
      await postPaymentResponse({
        subscriptionId,
        userId,
        transactionId,
        status: "P",
        amount: totalAmount,
        paymentMode: "N/A",
        transactionDate,
        remarks: "Payment pending",
      });

      return res.redirect(
        `${decodeURIComponent(
          returnUrl
        )}?status=pending&transactionId=${transactionId}`
      );
    } else {
      await postPaymentResponse({
        subscriptionId,
        userId,
        transactionId,
        status: "R",
        amount: totalAmount,
        paymentMode: "N/A",
        transactionDate,
        remarks: "Payment failed",
      });

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

router.post("/checkpayment", async (req, res) => {
  try {
    const { transactionId } = req.query;

    console.log("req.query", transactionId);

    if (!transactionId) {
      throw new Error("Cannot find Merchant Transaction ID");
    }

    const statusUrl = `${PHONE_PE_HOST_URL}/pg/v1/status/${MERCHANT_ID}/${transactionId}`;
    const string = `/pg/v1/status/${MERCHANT_ID}/${transactionId}${SALT_KEY}`;
    const sha256_val = sha256(string).toString();
    const xVerifyChecksum = `${sha256_val}###${SALT_INDEX}`;

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
    const data = response.data;

    // Handle the response data according to your business logic
    // For example, update the payment status in your database

    res.status(200).json({
      message: "Payment status retrieved successfully",
      data,
    });
  } catch (error) {
    console.error("Error in /payment/callback:", error.message);
    res.status(500).json({
      message: "Internal Server Error",
      error: error.message,
    });
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

router.get("/sendSignup", async (req, res) => {
  const { phone, link } = req.query;
  try {
    const response = await fetchSubscriptionData();
    res.status(200).json({ success: true, data: response });
  } catch (error) {
    console.log(error.message);
    res.status(500).json("Some error in the api");
  }
});

const sendSignupMessage = async (phoneNumber) => {
  const url = "https://backend.aisensy.com/campaign/t1/api/v2";
  const data = {
    apiKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2MmM5ZWNiOTNhMmJkMGFlZTVlMGZiMiIsIm5hbWUiOiJIYWlsZ3JvIHRlY2ggc29sdXRpb25zIHB2dC4gbHRkLiIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2NjJjOWVjYjkzYTJiZDBhZWU1ZTBmYWIiLCJhY3RpdmVQbGFuIjoiQkFTSUNfTU9OVEhMWSIsImlhdCI6MTcxNDIwMDI2N30.fQE69zoffweW2Z4_pMiXynoJjextT5jLrhXp6Bh1FgQ",
    campaignName: "⁠new_signup_1 (On Sign Up) (TEXT)",
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
    console.log("Response:", response.data);
    return response;
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
};

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
    console.log("Response:", response.data);
    return response;
  } catch (error) {
    console.error("Error:", error);
  }
};

const signedUser2Discount = async (
  discount,
  expertName,
  channelName,
  experience,
  followers,
  raid,
  phoneNumber
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
    console.log("Response:", response.data);
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
      .filter((sub) => sub.discountPercentage)
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
    "https://copartners.in:5134/api/UserData/UserFirstTimePaymentListing?page=1&pageSize=10000";
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

// Schedule the task to run at two times on Friday
cron.schedule("0 17 * * 5", async () => {
  console.log("Running task at 5 PM every Friday");
  const subscriptions = await fetchSubscriptionData();
  const users = await fetchUserData();

  if (subscriptions.length > 0 && users.length > 0) {
    for (const subscription of subscriptions) {
      for (const user of users) {
        await signedUser2Discount(
          subscription.discountPercentage,
          subscription.experts.name,
          subscription.experts.channelName,
          subscription.experts.experience,
          subscription.experts.telegramFollower,
          subscription.expertsId,
          user.mobileNumber
        );
      }
    }
  } else {
    console.log("No subscriptions or users found.");
  }
});

cron.schedule("0 19 * * 5", async () => {
  console.log("Running task at 7 PM every Friday");
  const subscriptions = await fetchSubscriptionData();
  const users = await fetchUserData();

  if (subscriptions.length > 0 && users.length > 0) {
    for (const subscription of subscriptions) {
      for (const user of users) {
        await signedUser2Discount(
          subscription.discountPercentage,
          subscription.experts.name,
          subscription.experts.channelName,
          subscription.experts.experience,
          subscription.experts.telegramFollower,
          subscription.expertsId,
          user.mobileNumber
        );
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
    campaignName: "⁠⁠paid_telegram_link (Upon KYC completion) (TEXT)",
    destination: phoneNumber,
    userName: "Hailgro tech solutions pvt. ltd.",
    templateParams: [`${link}`],
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

const sendFriday1030amMessage = async (phoneNumber) => {
  const url = "https://backend.aisensy.com/campaign/t1/api/v2";
  const data = {
    apiKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2MmM5ZWNiOTNhMmJkMGFlZTVlMGZiMiIsIm5hbWUiOiJIYWlsZ3JvIHRlY2ggc29sdXRpb25zIHB2dC4gbHRkLiIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2NjJjOWVjYjkzYTJiZDBhZWU1ZTBmYWIiLCJhY3RpdmVQbGFuIjoiQkFTSUNfTU9OVEhMWSIsImlhdCI6MTcxNDIwMDI2N30.fQE69zoffweW2Z4_pMiXynoJjextT5jLrhXp6Bh1FgQ",
    campaignName:
      "⁠⁠paid_user_friday_1030am_3 (FRIDAY 10:30AM - ACCORDING TO PAID RA) (IMAGE)",
    destination: phoneNumber,
    userName: "Hailgro tech solutions pvt. ltd.",
    templateParams: ["$sample1", "$sample2"],
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
    console.log("Response:", response.data);
  } catch (error) {
    console.error("Error:", error);
  }
};

const sendDiscount4Message = async (phoneNumber) => {
  const url = "https://backend.aisensy.com/campaign/t1/api/v2";
  const data = {
    apiKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2MmM5ZWNiOTNhMmJkMGFlZTVlMGZiMiIsIm5hbWUiOiJIYWlsZ3JvIHRlY2ggc29sdXRpb25zIHB2dC4gbHRkLiIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2NjJjOWVjYjkzYTJiZDBhZWU1ZTBmYWIiLCJhY3RpdmVQbGFuIjoiQkFTSUNfTU9OVEhMWSIsImlhdCI6MTcxNDIwMDI2N30.fQE69zoffweW2Z4_pMiXynoJjextT5jLrhXp6Bh1FgQ",
    campaignName:
      "⁠⁠signed_user_2_discount (FRIDAY -1PM TO 10PM UPTO 2 ON OTHER THAN PAID RA PROVIDING DISCOUNT) (IMAGE)",
    destination: phoneNumber,
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
    console.log("Response:", response.data);
  } catch (error) {
    console.error("Error:", error);
  }
};

const sendCampaignMessage = async (phone) => {
  const url = "https://backend.aisensy.com/campaign/t1/api/v2";
  const data = {
    apiKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2MmM5ZWNiOTNhMmJkMGFlZTVlMGZiMiIsIm5hbWUiOiJIYWlsZ3JvIHRlY2ggc29sdXRpb25zIHB2dC4gbHRkLiIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2NjJjOWVjYjkzYTJiZDBhZWU1ZTBmYWIiLCJhY3RpdmVQbGFuIjoiQkFTSUNfTU9OVEhMWSIsImlhdCI6MTcxNDIwMDI2N30.fQE69zoffweW2Z4_pMiXynoJjextT5jLrhXp6Bh1FgQ",
    campaignName: "singup_telegram_link(Just after signup campaign1)[TEXT]",
    destination: phone,
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
    console.log("Response:", response.data);
  } catch (error) {
    console.error("Error:", error);
  }
};

module.exports = router;
