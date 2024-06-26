const mongoose = require('mongoose')

// Create a schema for chat members
const chatMemberSchema = new mongoose.Schema({
    chatId: { type: String, required: true, index: true },
    channelName: { type: String, required: true, index: true },
    joinedMembersCount: { type: Number, default: 0 },
    leftMembersCount: { type: Number, default: 0 },
    members: [{
      memberId: { type: Number, required: true },
      chatLink: { type: String },
      joinedAt: { type: Date },
      leftAt: { type: Date },
    }],
  });
  
  // Create a compound index for channelName and memberId in members array
  chatMemberSchema.index({ channelName: 1, 'members.memberId': 1 });

  // Create a model from the schema
  const ChatMember = mongoose.model('ChatMember', chatMemberSchema);

  module.exports = ChatMember;
