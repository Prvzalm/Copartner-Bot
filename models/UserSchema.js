const mongoose = require("mongoose");

const joinDetailsSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
  },
  joinTime: {
    type: Date,
    default: Date.now,
    required: true,
  },
  leftTime: {
    type: Date,
  },
});

const inviteLinkSchema = new mongoose.Schema({
  chatLink: {
    type: String,
    required: true,
  },
  joinDetails: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "JoinDetails",
    required: true,
  },
  chat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Chat",
    required: true,
  },
});

const chatSchema = new mongoose.Schema({
  chatId: {
    type: Number,
    required: true,
    unique: true,
  },
  channelName: {
    type: String,
  },
});

const InviteLink = mongoose.model("InviteLink", inviteLinkSchema);
const Chat = mongoose.model("Chat", chatSchema);
const JoinDetails = mongoose.model("JoinDetails", joinDetailsSchema);

module.exports = { InviteLink, Chat, JoinDetails };
