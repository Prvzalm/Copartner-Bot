const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const channelSchema = new Schema({
  chatId: { type: String, required: true },
  channelName: { type: String },
  telegramLinks: [{ type: String }],
});

const JoinBot = mongoose.model("JoinBot", channelSchema);

module.exports = JoinBot;
