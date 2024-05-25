import React, { useState } from 'react';
import axios from 'axios';

const PaymentSuccess = () => {
  const [chatId, setChatId] = useState('');
  const [durationMonths, setDurationMonths] = useState('');
  const [inviteLink, setInviteLink] = useState([]);
  const [revokeLink, setRevokeLink] = useState('');
  const [revokeSuccess, setRevokeSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleCreateInviteLink = async () => {
    if (!chatId || !durationMonths) {
      setErrorMessage('Please enter both Chat ID and Duration');
      return;
    }
    try {
      const response = await axios.post(`http://localhost:3001/api/createInviteLink?chatId=${chatId}&durationMonths=${durationMonths}`);
      setInviteLink(response.data.inviteLink.inviteLink);
      setRevokeSuccess(false);
      setErrorMessage('');
    } catch (error) {
      console.error('Error creating invite link:', error);
      setErrorMessage(error.response?.data?.error || 'Failed to create invite link');
    }
  };

  const handleRevokeInviteLink = async () => {
    if (!revokeLink) {
      setErrorMessage('Please enter an Invite Link to revoke');
      return;
    }
    try {
      const response = await axios.post(`http://localhost:3001/api/revokeInviteLink?chatId=${chatId}&inviteChatLink=${revokeLink}`);
      if (response.data.inviteLink) {
        setRevokeSuccess(true);
        setErrorMessage('');
      }
    } catch (error) {
      console.error('Error revoking invite link:', error);
      setRevokeSuccess(false);
      setErrorMessage(error.response?.data?.error || 'Failed to revoke invite link');
    }
  };

  return (
    <div>
      <h1>Payment Successful!</h1>
      <input
        type="text"
        placeholder="Enter Chat ID"
        value={chatId}
        onChange={(e) => setChatId(e.target.value)}
      />
      <input
        type="text"
        placeholder="Enter Duration in Months"
        value={durationMonths}
        onChange={(e) => setDurationMonths(e.target.value)}
      />
      <button onClick={handleCreateInviteLink}>Generate Invite Link</button>
      <br />
      {inviteLink && (
        <div>
          <h2>Invite Link:</h2>
          <a href={inviteLink} target="_blank" rel="noopener noreferrer">
            {inviteLink}
          </a>
        </div>
      )}
      <input
        type="text"
        placeholder="Enter Invite Link to Revoke"
        value={revokeLink}
        onChange={(e) => setRevokeLink(e.target.value)}
      />
      <button onClick={handleRevokeInviteLink}>Revoke Invite Link</button>
      {revokeSuccess && <div><h2>Invite Link Revoked Successfully</h2></div>}
      {errorMessage && <div style={{ color: 'red' }}>{errorMessage}</div>}
    </div>
  );
};

export default PaymentSuccess;
