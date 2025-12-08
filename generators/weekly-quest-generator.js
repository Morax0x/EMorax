const { createCanvas, loadImage } = require('canvas'); // ❌ تم حذف registerFont
const { AttachmentBuilder } = require('discord.js');
// ❌ تم حذف path و fs لأننا لم نعد نحتاج تحميل ملفات هنا

// --- ( 1. تعريف الخطوط ) ---
// نستخدم الاسم "Cairo" الذي سجلناه في ملف index.js
const FONT_MAIN = '"Cairo", "NotoEmoji"'; 
const FONT_EMOJI = '"NotoEmoji"'; 

const FONT_PAGE_TITLE = FONT_MAIN;
const FONT_QUEST_TITLE = FONT_MAIN;
const FONT_ACH_DESCRIPTION = FONT_MAIN;
const FONT_COUNTDOWN = FONT_MAIN;
const FONT_REWARDS = FONT_MAIN;
const FONT_PROGRESS_TEXT = FONT_MAIN;

// (اللون الأزرق للمهام الأسبوعية)
const WEEKLY_COLOR = { base: '#1a3e4b', frame: '#2d6a86', highlight: '#349eeb', glow: '#69bfff' };

const COLOR_XP = '#349eeb'; 
const COLOR_MORA = '#ebc934'; 

const BASE_COLORS = {
    background: '#1a1827', 
    text: '#FFFFFF',
    subText: '#B0B0B0',
    hexBg: '#2a273b', 
};

const EMOJI_MORA = 'M';
const EMOJI_STAR = 'XP';
const PADDING = 20;
const PAGE_MARGIN = 25;
const CARD_WIDTH = 800;
const CARD_HEIGHT = 180;
const PAGE_WIDTH = CARD_WIDTH + (PAGE_MARGIN * 2);

function getEmojiUrl(emoji) {
    if (!emoji) return null;
    const customMatch = emoji.match(/<?(a)?:?(\w{2,32}):(\d{17,19})>?/);
    if (customMatch) {
        const ext = customMatch[1] ? 'gif' : 'png';
        return `https://cdn.discordapp.com/emojis/${customMatch[3]}.${ext}`;
    }
    try {
        if (/^[a-zA-Z0-9\s]+$/.test(emoji)) return null;
        const codePoints = [...emoji]
            .map(c => c.codePointAt(0).toString(16))
            .filter(cp => cp !== 'fe0f') 
            .join('-');
        return `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${codePoints}.png`;
    } catch (e) {
        return null; 
    }
}

function getWeeklyResetCountdown() {
    const KSA_TIMEZONE_OFFSET = 3 * 60; 
    const now = new Date();
    const nowUTC = now.getTime() + (now.getTimezoneOffset() * 60000);
    const nowKSA = new Date(nowUTC + (KSA_TIMEZONE_OFFSET * 60000));
    const dayOfWeek = nowKSA.getUTCDay(); 
    const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
    const nextFriday = new Date(nowKSA);
    nextFriday.setDate(nowKSA.getDate() + daysUntilFriday);
    nextFriday.setHours(0, 0, 0, 0); 
    if (daysUntilFriday === 0 && nowKSA.getTime() > nextFriday.getTime()) {
        nextFriday.setDate(nextFriday.getDate() + 7);
    }
    const msRemaining = nextFriday.getTime() - nowKSA.getTime();
    const days = Math.floor(msRemaining / (1000 * 60 * 60 * 24));
    const hours = Math.floor((msRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return `تتجدد خلال: ${days} ي و ${hours} س`;
}

function drawRoundedRect(ctx, x, y, width, height, radius) { 
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}
function drawProgressBar(ctx, x, y, width, height, progressPercent, colorStart, colorEnd) { 
    ctx.save();
    ctx.fillStyle = '#2c2f33';
    drawRoundedRect(ctx, x, y, width, height, height / 2);
    ctx.fill();
    if (progressPercent > 0) {
        const progressGradient = ctx.createLinearGradient(x, 0, x + width, 0);
        progressGradient.addColorStop(0, colorStart);
        progressGradient.addColorStop(1, colorEnd);
        ctx.fillStyle = progressGradient;
        drawRoundedRect(ctx, x, y, width * progressPercent, height, height / 2);
        ctx.fill();
    }
    ctx.restore();
}
function drawWavyBackground(ctx, x, y, width, height, color1, color2) { 
    ctx.save();
    drawRoundedRect(ctx, x, y, width, height, 15);
    ctx.clip(); 
    const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
    gradient.addColorStop(0, color1);
    gradient.addColorStop(1, color2);
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(x, y + (height / 5) * i);
        for (let j = 0; j <= width; j += 20) {
            const waveHeight = Math.sin((j / width) * Math.PI * 3 + i) * 10;
            ctx.lineTo(x + j, y + (height / 5) * i + waveHeight);
        }
        ctx.stroke();
    }
    ctx.restore();
}

// --- (دالة رسم البطاقة - ASYNC) ---
async function drawQuestCard(ctx, x, y, questData) {
    const { quest, progress } = questData;
    const isDone = progress >= quest.goal;
    const percent = Math.min(1, Math.max(0, progress / quest.goal));

    const rarityColors = WEEKLY_COLOR; 

    ctx.save();

    // 1. الخلفية
    drawWavyBackground(ctx, x, y, CARD_WIDTH, CARD_HEIGHT, BASE_COLORS.background, '#11101a');

    // 2. الإطار
    ctx.strokeStyle = rarityColors.highlight;
    ctx.shadowColor = rarityColors.highlight;
    ctx.shadowBlur = isDone ? 20 : 10;
    ctx.lineWidth = 3;
    drawRoundedRect(ctx, x, y, CARD_WIDTH, CARD_HEIGHT, 15);
    ctx.stroke();

    ctx.strokeStyle = rarityColors.glow;
    ctx.shadowColor = rarityColors.glow;
    ctx.shadowBlur = isDone ? 10 : 5;
    ctx.lineWidth = 1;
    drawRoundedRect(ctx, x + 3, y + 3, CARD_WIDTH - 6, CARD_HEIGHT - 6, 12);
    ctx.stroke();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // 3. الشكل السداسي
    const hexRadius = 55;
    const hexX = x + PADDING + hexRadius;
    const hexY = y + CARD_HEIGHT / 2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        ctx.lineTo(hexX + hexRadius * Math.cos(Math.PI / 3 * i), hexY + hexRadius * Math.sin(Math.PI / 3 * i));
    }
    ctx.closePath();
    ctx.fillStyle = BASE_COLORS.hexBg;
    ctx.fill();
    ctx.strokeStyle = rarityColors.frame;
    ctx.lineWidth = 3;
    ctx.stroke();

    // 4. رسم الإيموجي
    try {
        const emojiStr = quest.emoji || '📅'; 
        const emojiUrl = getEmojiUrl(emojiStr);

        if (emojiUrl) {
            const img = await loadImage(emojiUrl);
            ctx.drawImage(img, hexX - 30, hexY - 30, 60, 60);
        } else {
            ctx.font = `60px ${FONT_EMOJI}`; 
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = BASE_COLORS.text;
            ctx.fillText(emojiStr, hexX, hexY);
        }
    } catch (err) {}

    const textX = hexX + hexRadius + PADDING;
    const textRightX = x + CARD_WIDTH - PADDING;
    const barWidth = (x + CARD_WIDTH - PADDING) - textX;

    // 5. النصوص
    ctx.fillStyle = isDone ? rarityColors.glow : BASE_COLORS.text;
    
    // 👇 استخدام الخط الموحد هنا
    ctx.font = `bold 32px ${FONT_QUEST_TITLE}`;
    
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(quest.name, textX, y + PADDING);

    if (quest.description) {
        ctx.fillStyle = BASE_COLORS.subText;
        ctx.font = `18px ${FONT_ACH_DESCRIPTION}`;
        ctx.textAlign = 'left';
        ctx.fillText(quest.description, textX, y + PADDING + 45); 
    }

    // 6. المكافآت
    ctx.textAlign = 'right'; 
    const rewardY = y + 65; 
    const rewardXStart = textRightX; 

    ctx.font = `bold 20px ${FONT_ACH_DESCRIPTION}`; 

    // XP
    ctx.fillStyle = COLOR_XP; 
    const xpText = `${quest.reward.xp.toLocaleString()}`;
    const xpTextWidth = ctx.measureText(xpText).width;
    ctx.fillText(xpText, rewardXStart - 25, rewardY); 
    ctx.fillText(EMOJI_STAR, rewardXStart, rewardY); 

    // Mora
    const moraRewardXStart = rewardXStart - 25 - xpTextWidth - 35; 
    ctx.fillStyle = COLOR_MORA; 
    const moraText = `${quest.reward.mora.toLocaleString()}`;
    ctx.fillText(moraText, moraRewardXStart - 25, rewardY); 
    ctx.fillText(EMOJI_MORA, moraRewardXStart, rewardY);

    // 7. التقدم
    const barY = y + 103; 
    drawProgressBar(ctx, textX, barY, barWidth, 15, percent, rarityColors.highlight, rarityColors.glow);

    ctx.fillStyle = BASE_COLORS.subText;
    ctx.font = `18px ${FONT_ACH_DESCRIPTION}`;
    ctx.textAlign = 'left';
    const progressText = `التقدم: ${progress.toLocaleString()} / ${quest.goal.toLocaleString()}`;
    ctx.fillText(progressText, textX, barY + 25); 

    ctx.restore();
}

async function generateWeeklyQuestsImage(member, questsData, page = 1) {
    const perPage = 4; 
    const totalPages = Math.ceil(questsData.length / perPage) || 1;
    page = Math.max(1, Math.min(page, totalPages)); 

    const start = (page - 1) * perPage;
    const end = start + perPage;
    const questsToShow = questsData.slice(start, end); 

    const pageHeight = (CARD_HEIGHT + PADDING) * questsToShow.length + (PAGE_MARGIN * 2) + 80;

    const canvas = createCanvas(PAGE_WIDTH, pageHeight);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = BASE_COLORS.background;
    ctx.fillRect(0, 0, PAGE_WIDTH, pageHeight);

    const avatarSize = 60; 
    const avatarY = PAGE_MARGIN;
     
    // --- ( التنسيق الجديد ) ---
    ctx.fillStyle = BASE_COLORS.text;
    
    // 👇 استخدام الخط الموحد هنا
    ctx.font = `bold 36px ${FONT_PAGE_TITLE}`; 
    
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`المهام الأسبوعية لـ ${member.displayName}`, PAGE_MARGIN + PADDING, avatarY + avatarSize / 2);

    ctx.fillStyle = BASE_COLORS.subText;
    ctx.font = `24px ${FONT_COUNTDOWN}`; 
    ctx.textAlign = 'right';
     
    ctx.fillText(`صفحة ${page}/${totalPages}`, PAGE_WIDTH - PAGE_MARGIN - PADDING, avatarY + 15);

    const countdownText = getWeeklyResetCountdown();
    ctx.fillText(countdownText, PAGE_WIDTH - PAGE_MARGIN - PADDING, avatarY + 45);
    // ------------------------

    let currentY = PAGE_MARGIN + 80;
    for (const data of questsToShow) { 
        await drawQuestCard(ctx, PAGE_MARGIN, currentY, data);
        currentY += CARD_HEIGHT + PADDING;
    }

    const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: `weekly-quests-${member.id}-p${page}.png` });

    return { attachment, totalPages };
}

module.exports = {
    generateWeeklyQuestsImage
};
