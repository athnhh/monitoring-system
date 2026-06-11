/**
 * EmailJS configuration — client-side email sending
 * Safe to expose in front-end code (public key is designed for this).
 *
 * Setup:
 * 1. Sign up at https://www.emailjs.com/
 * 2. Create an Email Service → get Service ID
 * 3. Create an Email Template → get Template ID
 * 4. Copy your Public Key, Service ID, and Template ID below
 */
window.EMAILJS_CONFIG = {
  publicKey: 'XyyVON1T594-zsJU',
  serviceId: 'service_dt6xgoo',
  templateId: 'template_wbnkjco',
  fromEmail: 'admin@quemahtech.com'
};

// Initialize EmailJS with the public key (required before send)
if (typeof emailjs !== 'undefined') {
  emailjs.init(window.EMAILJS_CONFIG.publicKey);
}
