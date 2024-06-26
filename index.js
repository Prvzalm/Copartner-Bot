const { Telegraf } = require("telegraf");
const mongoose = require("mongoose");
const express = require("express");
const { Chat } = require("./models/UserSchema");
const cors = require("cors");
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

    if (new Date() > inviteLinkRecord.expirationDate) {
      console.log("Expired invite link used:", inviteLink);
      return;
    } else {
      inviteLinkRecord.memberId = memberId;
      inviteLinkRecord.status = "used";

      const revokeResponse = await fetch(
        `https://api.telegram.org/bot${token}/revokeChatInviteLink?chat_id=${chatId}&invite_link=${inviteLink}`,
        { method: "POST" }
      );
      const revokeData = await revokeResponse.json();
      if (revokeData.ok) {
        console.log("Invite link revoked after use:", inviteLink);
        await existingChat.save();
        console.log("Member joined and recorded:", memberId);
      } else {
        console.error(
          "Failed to revoke invite link after use:",
          revokeData.description
        );
      }
    }
  } catch (error) {
    console.error("Error handling new chat member:", error);
  }
});

// bot.on("chat_member", async (ctx) => {
//   const chatName = ctx.chatMember.chat.title;
//   const chatId = ctx.chatMember.chat.id;
//   const memberId = ctx.chatMember.new_chat_member.user.id;
//   const chatLink = ctx.chatMember.invite_link
//     ? ctx.chatMember.invite_link.invite_link
//     : "None";
//   const status = ctx.chatMember.new_chat_member.status;

//   async function addOrUpdate() {
//     try {
//       const updateResult = await ChatMember.findOneAndUpdate(
//         { channelName: chatName }, // Check if memberId doesn't exist
//         {
//           $set: { chatId: chatId },
//           $inc: { joinedMembersCount: 1 },
//           $push: {
//             members: {
//               memberId,
//               chatLink: chatLink,
//               joinedAt: new Date(),
//             },
//           },
//         },
//         { upsert: true, new: true }
//       );

//       if (updateResult) {
//         console.log(
//           `Member joined/updated! Channel ID: ${chatName}, Member ID: ${memberId}, Chat Link: ${chatLink}`
//         );
//       } else {
//         console.log(`Member unable to be found/updated in ${chatName}.`);
//       }
//     } catch (error) {
//       console.error("Error updating chat member in MongoDB:", error);
//     }
//   }

//   async function memberLeft() {
//     try {
//       // Update leftAt for the member in MongoDB
//       const updateResult = await ChatMember.findOneAndUpdate(
//         { channelName: chatName, "members.memberId": memberId },
//         {
//           $inc: { leftMembersCount: 1 },
//           $set: { "members.$.leftAt": new Date() },
//         }
//       );

//       if (updateResult) {
//         console.log(
//           `Member left! Channel ID: ${chatName}, Member ID: ${memberId}`
//         );
//       } else {
//         console.log("Member not found or not updated.");
//       }
//     } catch (error) {
//       console.error("Error updating leftAt in MongoDB:", error);
//     }
//   }

//   if (status === "member") {
//     addOrUpdate();
//   } else if (status === "kicked" || status === "left" || status === "banned") {
//     memberLeft();
//   }
// });

async function revokeInviteLinkAndBanMember(
  chatId,
  memberId,
  inviteLink,
  inviteLinkRecord,
  existingChat
) {
  try {
    const revokeResponse = await fetch(
      `https://api.telegram.org/bot${token}/revokeChatInviteLink?chat_id=${chatId}&invite_link=${inviteLink}`,
      { method: "POST" }
    );
    const revokeData = await revokeResponse.json();
    if (revokeData.ok) {
      console.log("Invite link revoked:", inviteLink);
    } else {
      throw new Error(
        `Failed to revoke invite link: ${revokeData.description}`
      );
    }

    const banResponse = await fetch(
      `https://api.telegram.org/bot${token}/unbanChatMember?chat_id=${chatId}&user_id=${memberId}`,
      { method: "POST" }
    );
    const banData = await banResponse.json();

    if (!banData.ok) {
      throw new Error(`Failed to remove member: ${banData.description}`);
    }
    inviteLinkRecord.status = "removed";
    await existingChat.save();
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

app.use(cors());
app.use(express.json());
app.use("/api", require("./routes/Telegram"));

// bot.launch({
//   allowedUpdates: ["channel_post", "chat_member"],
// });

app.listen(PORT, () => console.log(`Server is running on Port ${PORT}`));
