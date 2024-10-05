const { Telegraf } = require("telegraf");
const mongoose = require("mongoose");
const express = require("express");
const { Chat } = require("./models/UserSchema");
const cors = require("cors");
const axios = require("axios");
const cron = require("node-cron");
const { ChatName } = require("./models/ChatNameSchema");
const ChatMember = require("./models/ChatMemberSchema");
require("dotenv").config();

const app = express();
const PORT = 3101;
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

async function checkAndHandleExpiredInviteLinks() {
  try {
    const chats = await Chat.find({ "inviteLinks.status": "used" });
    const currentTime = new Date();

    for (const chat of chats) {
      for (const link of chat.inviteLinks) {
        if (link.status === "used" && currentTime > link.expirationDate) {
          console.log("Handling expired invite link:", link.inviteLink);
          await revokeInviteLinkAndBanMember(
            chat.chatId,
            link.memberId,
            link.inviteLink,
            link,
            chat
          );
        }
      }
    }
  } catch (error) {
    console.error("Error processing expired invite links:", error);
  }
}

cron.schedule("0 0 * * *", () => {
  console.log("Daily check for expired invite links at midnight...");
  checkAndHandleExpiredInviteLinks();
});

bot.on("chat_member", async (ctx, next) => {
  const chatId = ctx.chat.id.toString();
  const memberId = ctx.chatMember.new_chat_member.user.id.toString();
  const inviteLink = ctx.chatMember.invite_link?.invite_link;

  try {
    const existingChat = await Chat.findOne({ chatId });
    if (!existingChat) {
      console.error("Chat not found with ID:", chatId);
      return;
    }

    const inviteLinkRecord = existingChat.inviteLinks.find(
      (link) => link.inviteLink === inviteLink
    );

    if (!inviteLinkRecord) {
      console.log("No record of invite link used:", inviteLink);
      return;
    }

    if (inviteLinkRecord.status !== "active") {
      console.log("Invite link not active:", inviteLink);
      return;
    }

    const currentTime = new Date();
    if (currentTime > inviteLinkRecord.expirationDate) {
      console.log("Expired invite link used:", inviteLink);
      inviteLinkRecord.status = "expired";  // Mark link as expired
    } else {
      inviteLinkRecord.memberId = memberId;
      inviteLinkRecord.status = "used";  // Only mark as used if it's valid and not expired

      // Ensure all necessary fields are correctly set before saving
      if (typeof inviteLinkRecord.durationMonths === 'number' && inviteLinkRecord.inviteLink) {
        await existingChat.save();
        console.log("Member joined and recorded for:", inviteLink, "with memberId", memberId);
      } else {
        console.error("Required fields missing in invite link record");
        return;
      }
    }
  } catch (error) {
    console.error("Error handling new chat member:", error);
  } finally {
    return next();
  }
});

bot.on("chat_member", async (ctx) => {
  const chatName = ctx.chatMember.chat.title;
  const chatId = ctx.chatMember.chat.id;
  const memberId = ctx.chatMember.new_chat_member.user.id;
  const chatLink = ctx.chatMember.invite_link
    ? ctx.chatMember.invite_link.invite_link
    : "None";
  const status = ctx.chatMember.new_chat_member.status;

  async function addOrUpdate() {
    try {
      const updateResult = await ChatMember.findOneAndUpdate(
        { channelName: chatName }, // Check if memberId doesn't exist
        {
          $set: { chatId: chatId },
          $inc: { joinedMembersCount: 1 },
          $push: {
            members: {
              memberId,
              chatLink: chatLink,
              joinedAt: new Date(),
            },
          },
        },
        { upsert: true, new: true }
      );

      if (updateResult) {
        console.log(
          `Member joined/updated! Channel ID: ${chatName}, Member ID: ${memberId}, Chat Link: ${chatLink}`
        );
      } else {
        console.log(`Member unable to be found/updated in ${chatName}.`);
      }
    } catch (error) {
      console.error("Error updating chat member in MongoDB:", error);
    }
  }

  async function memberLeft() {
    try {
      // Update leftAt for the member in MongoDB
      const updateResult = await ChatMember.findOneAndUpdate(
        { channelName: chatName, "members.memberId": memberId },
        {
          $inc: { leftMembersCount: 1 },
          $set: { "members.$.leftAt": new Date() },
        }
      );

      if (updateResult) {
        console.log(
          `Member left! Channel ID: ${chatName}, Member ID: ${memberId}`
        );
      } else {
        console.log("Member not found or not updated.");
      }
    } catch (error) {
      console.error("Error updating leftAt in MongoDB:", error);
    }
  }

  if (status === "member") {
    addOrUpdate();
  } else if (status === "kicked" || status === "left" || status === "banned") {
    memberLeft();
  }
});

async function revokeInviteLinkAndBanMember(
  chatId,
  memberId,
  inviteLink,
  inviteLinkRecord,
  existingChat
) {
  try {
    const [revokeResponse, banResponse] = await Promise.all([
      fetch(
        `https://api.telegram.org/bot${token}/revokeChatInviteLink?chat_id=${chatId}&invite_link=${inviteLink}`,
        { method: "POST" }
      ),
      fetch(
        `https://api.telegram.org/bot${token}/unbanChatMember?chat_id=${chatId}&user_id=${memberId}`,
        { method: "POST" }
      ),
    ]);

    const revokeData = await revokeResponse.json();
    const banData = await banResponse.json();

    if (revokeData.ok && banData.ok) {
      console.log("Invite link revoked and member banned:", inviteLink);
      inviteLinkRecord.status = "removed"; // Mark as removed after successful revocation and ban
      await existingChat.save();
    } else {
      if (!revokeData.ok) {
        throw new Error(
          `Failed to revoke invite link: ${revokeData.description}`
        );
      }
      if (!banData.ok) {
        throw new Error(`Failed to ban member: ${banData.description}`);
      }
    }
  } catch (error) {
    console.error("Error during revocation and member removal process:", error);
  }
}

bot.on("channel_post", async (ctx) => {
  const { id: chatId, title: chatName } = ctx.chat;

  try {
    const result = await ChatName.findOneAndUpdate(
      { chatId },
      { chatName },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    if (result) {
      if (result.isNew) {
        console.log(
          "New chat added with ID and channel name:",
          chatId,
          chatName
        );
      } else {
        console.log("Chat updated with new channel name:", chatName);
      }
    }
  } catch (error) {
    console.error("Error handling channel post:", error);
  }
});

const sendSunday11amMessage = async (phoneNumber) => {
  const url = "https://backend.aisensy.com/campaign/t1/api/v2";
  const data = {
    apiKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2MmM5ZWNiOTNhMmJkMGFlZTVlMGZiMiIsIm5hbWUiOiJIYWlsZ3JvIHRlY2ggc29sdXRpb25zIHB2dC4gbHRkLiIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2NjJjOWVjYjkzYTJiZDBhZWU1ZTBmYWIiLCJhY3RpdmVQbGFuIjoiQkFTSUNfTU9OVEhMWSIsImlhdCI6MTcxNDIwMDI2N30.fQE69zoffweW2Z4_pMiXynoJjextT5jLrhXp6Bh1FgQ",
    campaignName: "⁠⁠new_signed_user_sunday_11am (sunday 11 AM) (TEXT)",
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
    return response;
  } catch (error) {
    console.error("Error:", error);
  }
};

const fetchUserData = async () => {
  const url =
    "https://copartners.in:5134/api/UserData/UserDataListing?page=1&pageSize=100";
  try {
    const response = await axios.get(url, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    return response.data; // Assuming the data contains an array of users
  } catch (error) {
    console.error("Error fetching user data:", error);
    return [];
  }
};

// Schedule the task to run at 11 AM every Sunday
cron.schedule("0 11 * * 0", async () => {
  console.log("Running task at 11 AM every Sunday");
  const users = await fetchUserData();
  if (users && users.length > 0) {
    for (const user of users) {
      await sendSunday11amMessage(user.mobile); // Assuming user data contains phoneNumber field
    }
  } else {
    console.log("No users found.");
  }
});

app.use(cors());
app.use(express.json());
app.use("/api", require("./routes/Telegram"));

// bot.launch({
//   allowedUpdates: ["channel_post", "chat_member"],
// });

app.listen(PORT, () => console.log(`Server is running on Port ${PORT}`));
