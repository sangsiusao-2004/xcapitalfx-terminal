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
      if (CONFIG.allowDevOtp) {
        console.log(`[DEV OTP] ${to} ${purpose}: ${code}`);
        return { sent: false, devOtp: code };
      }
      throw new Error('Chưa cấu hình Gmail SMTP để gửi mã xác thực.');
    }

    const transporter = nodemailer.createTransport({
      host: CONFIG.gmailSmtpHost,
      port: CONFIG.gmailSmtpPort,
      secure: CONFIG.gmailSmtpPort === 465,
      requireTLS: CONFIG.gmailSmtpPort !== 465,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      auth: {
        user: CONFIG.gmailUser,
        pass: CONFIG.gmailAppPassword.replace(/\s+/g, ''),
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

  if (CONFIG.emailProvider === 'emailjs') {
    if (!CONFIG.emailjsServiceId || !CONFIG.emailjsTemplateId || !CONFIG.emailjsPublicKey) {
      if (CONFIG.allowDevOtp) {
        console.log(`[DEV OTP] ${to} ${purpose}: ${code}`);
        return { sent: false, devOtp: code };
      }
      throw new Error('Chưa cấu hình EmailJS để gửi mã xác thực.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          service_id: CONFIG.emailjsServiceId,
          template_id: CONFIG.emailjsTemplateId,
          user_id: CONFIG.emailjsPublicKey,
          accessToken: CONFIG.emailjsPrivateKey || undefined,
          template_params: {
            to_email: to,
            user_email: to,
            email: to,
            otp_code: code,
            code,
            purpose,
            subject,
            message: text,
          },
        }),
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Kết nối EmailJS quá lâu. Vui lòng thử lại sau.');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`EmailJS error: ${text}`);
    }

    return { sent: true };
  }

  if (!CONFIG.resendApiKey) {
    if (CONFIG.allowDevOtp) {
      console.log(`[DEV OTP] ${to} ${purpose}: ${code}`);
      return { sent: false, devOtp: code };
    }
    throw new Error('Chưa cấu hình Resend API key để gửi mã xác thực.');
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
