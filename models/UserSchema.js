const mongoose = require("mongoose");

const inviteLinkSchema = new mongoose.Schema({
  inviteLink: { type: String, required: true },
  memberId: { type: String, default: null },
  userId: { type: String, default: null },
  number: { type: String, default: null },
  durationMonths: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
  expirationDate: { type: Date },
  isDays: { type: Boolean },
  status: {
    type: String,
    enum: ["active", "used", "removed"],
    default: "active",
  },
});

const chatSchema = new mongoose.Schema(
  {
    chatId: { type: String, required: true, unique: true },
    channelName: { type: String },
    inviteLinks: [inviteLinkSchema],
  },
  { timestamps: true }
);

chatSchema.index({ chatId: 1, "inviteLinks.inviteLink": 1 });

const Chat = mongoose.model("Chat", chatSchema);

module.exports = { Chat };
