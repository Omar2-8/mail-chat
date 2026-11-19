import type { Settings } from './types';

const TEXT_STYLE = 'font-family:Aptos,Calibri,Arial,sans-serif;font-size:10.5pt;color:#4a4a55;line-height:1.4';

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function textToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\r?\n/g, '<br>');
}

export function hasSignature(settings: Settings): boolean {
  if (settings.signatureMode === 'html') return settings.signatureHtml.trim().length > 0;
  if (settings.signatureMode === 'simple') return settings.signature.trim().length > 0 || settings.signatureLogo.length > 0;
  return false;
}

export function signatureHtml(settings: Settings): string {
  if (!hasSignature(settings)) return '';
  if (settings.signatureMode === 'html') return settings.signatureHtml;
  const text = settings.signature.trim();
  const textHtml = text ? `<div style="${TEXT_STYLE}">${textToHtml(text)}</div>` : '';
  const logo = settings.signatureLogo ? logoHtml(settings) : '';
  if (!logo) return textHtml;
  if (!textHtml) return logo;
  if (settings.signatureLayout === 'left') {
    return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td style="padding:0 14px 0 0;vertical-align:middle">${logo}</td><td style="padding:0 0 0 14px;border-left:2px solid #d4d4de;vertical-align:middle">${textHtml}</td></tr></table>`;
  }
  return `${textHtml}<div style="margin-top:8px">${logo}</div>`;
}

function logoHtml(settings: Settings): string {
  const height = Math.max(16, Math.min(160, Math.round(settings.signatureLogoHeight || 48)));
  const ratio = settings.signatureLogoRatio > 0 ? settings.signatureLogoRatio : 1;
  const width = Math.round(height * ratio);
  const img = `<img src="${escapeHtml(settings.signatureLogo)}" width="${width}" height="${height}" alt="logo" style="display:block;border:0;width:${width}px;height:${height}px">`;
  const link = settings.signatureLogoLink.trim();
  return /^(https?:|mailto:)/i.test(link) ? `<a href="${escapeHtml(link)}">${img}</a>` : img;
}
