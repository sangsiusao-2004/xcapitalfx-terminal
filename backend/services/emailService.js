const { CONFIG } = require('../config');
const nodemailer = require('nodemailer');

function renderOtpEmail({ code, purpose }) {
  const title = purpose === 'reset_password' ? 'XCapital AI - Dat lai mat khau' : 'XCapital AI - Xac thuc dang ky';
  return {
    subject: title,
    html: `
      <div style="font-family:Arial,sans-serif;background:#07100e;color:#d8ede8;padding:24px">
        <div style="max-width:520px;margin:auto;border:1px solid rgba(0,200,150,.35);border-radius:14px;padding:24px;background:#0c1117">
          <h2 style="color:#00e5b0;margin:0 0 12px">XCapital AI</h2>
          <p style="line-height:1.6">Ma xac thuc cua ban la:</p>
          <div style="font-size:32px;letter-spacing:8px;font-weight:700;color:#00e5b0;margin:18px 0">${code}</div>
          <p style="line-height:1.6;color:#7a9a90">Ma co hieu luc trong 10 phut. Neu ban khong yeu cau ma nay, vui long bo qua email.</p>
        </div>
      </div>
    `,
  };
}

async function sendOtpEmail({ to, code, purpose }) {
  const { subject, html } = renderOtpEmail({ code, purpose });
  const text = `Ma xac thuc XCapital AI cua ban la: ${code}. Ma co hieu luc trong 10 phut.`;

  if (CONFIG.emailProvider === 'gmail') {
    if (!CONFIG.gmailUser || !CONFIG.gmailAppPassword) {
      console.log(`[DEV OTP] ${to} ${purpose}: ${code}`);
      return { sent: false, devOtp: code };
    }

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: CONFIG.gmailUser,
        pass: CONFIG.gmailAppPassword,
      },
    });

    await transporter.sendMail({
      from: CONFIG.emailFrom || `XCapital AI <${CONFIG.gmailUser}>`,
      to,
      subject,
      text,
      html,
    });

    return { sent: true };
  }

  if (!CONFIG.resendApiKey) {
    console.log(`[DEV OTP] ${to} ${purpose}: ${code}`);
    return { sent: false, devOtp: code };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CONFIG.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: CONFIG.emailFrom,
      to,
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Email provider error: ${text}`);
  }

  return { sent: true };
}

module.exports = {
  sendOtpEmail,
};
