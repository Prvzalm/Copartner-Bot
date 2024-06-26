const mongoose = require("mongoose");

const chatNameSchema = new mongoose.Schema(
  {
    chatName: { type: String },
    chatId: { type: String },
  },
  {
    timestamps: true,
  }
);

const ChatName = mongoose.model("ChatName", chatNameSchema);

module.exports = { ChatName };
