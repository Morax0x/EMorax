const { AttachmentBuilder } = require("discord.js");
const { RankCardBuilder } = require("discord-card-canvas");

// دالة لتوليد كود لون سداسي عشري عشوائي (للفقاعات الخلفية فقط)
function getRandomColorHex() {
    const randomColor = Math.floor(Math.random() * 16777215).toString(16);
    return `#${randomColor.padStart(6, '0')}`;
}

module.exports = {
    name: 'rank',
    aliases: ['level', 'lvl', 'مستوى'],
    category: "Leveling",
    description: "Displays your current level and rank.",
    cooldown: 5,
    async execute(message, args) {
        try {
            const user = message.mentions.members.first() || message.guild.members.cache.get(args[0]) || message.member;

            const sql = message.client.sql;
            const getScore = message.client.getLevel;
            const score = getScore.get(user.id, message.guild.id);

            if (!score) {
                return message.reply("⚠️ **لم يتم تصنيف هذا العضو بعد.**");
            }

            const allScores = sql.prepare("SELECT * FROM levels WHERE guild = ? ORDER BY totalXP DESC").all(message.guild.id);
            const rank = allScores.findIndex(s => s.user === user.id) + 1;

            const requiredXP = 5 * (score.level ** 2) + (50 * score.level) + 100;

            // --- الألوان والتصميم ---
            const randomAccentColor = getRandomColorHex(); 
            const primaryColor = "#F1C40F"; // ذهبي (متناسق مع البوت)
            const secondaryColor = "#FFFFFF"; // أبيض للنصوص
            const backgroundColor = "#070d19"; // خلفية داكنة

            const userStatus = user.presence ? user.presence.status : "offline";

            const card = new RankCardBuilder({
                currentLvl: score.level,
                currentRank: rank,
                currentXP: score.xp, 
                requiredXP: requiredXP,

                // الخلفية والفقاعات
                backgroundColor: { background: backgroundColor, bubbles: randomAccentColor }, 

                avatarImgURL: user.user.displayAvatarURL({ extension: 'png', forceStatic: true }),

                // النصوص والخطوط (استخدام خط Bein)
                nicknameText: { content: user.user.username, font: 'Bein', color: primaryColor }, // اسم المستخدم
                userStatus: userStatus,
                progressbarColor: primaryColor, // شريط التقدم ذهبي
                
                // تفاصيل النصوص
                levelText: { font: 'Bein', color: secondaryColor },
                rankText: { font: 'Bein', color: secondaryColor },
                xpText: { font: 'Bein', color: secondaryColor },
            });

            const canvasRank = await card.build();
            const attachment = new AttachmentBuilder(canvasRank.toBuffer(), { name: 'rank.png' });
            
            message.channel.send({ files: [attachment] });

        } catch (error) {
            console.error("Error creating rank card:", error);
            message.reply("❌ حدث خطأ أثناء إنشاء البطاقة. تأكد من أن الخطوط محملة بشكل صحيح.");
        }
    }
}
