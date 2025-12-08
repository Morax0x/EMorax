const { AttachmentBuilder } = require("discord.js");
const { RankCardBuilder } = require("discord-card-canvas");

// دالة لتوليد كود لون سداسي عشري عشوائي
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
                return message.reply("This user is not ranked yet.");
            }

            const allScores = sql.prepare("SELECT * FROM levels WHERE guild = ? ORDER BY totalXP DESC").all(message.guild.id);
            const rank = allScores.findIndex(s => s.user === user.id) + 1;

            const requiredXP = 5 * (score.level ** 2) + (50 * score.level) + 100;

            // --- الألوان ---
            const randomAccentColor = getRandomColorHex(); // لون عشوائي للفقاعات

            // الألوان الثابتة (الزرقاء) التي لا يمكن تغييرها
            const hardcodedBlue = "#0CA7FF"; 
            const backgroundColor = "#070d19";

            const userStatus = user.presence ? user.presence.status : "offline";

            // الكود الذي يعمل (نمط الكائن)
            const card = new RankCardBuilder({
                currentLvl: score.level,
                currentRank: rank,
                currentXP: score.xp, 
                requiredXP: requiredXP,

                // 1. الفقاعات (الشيء الوحيد الذي يتغير)
                backgroundColor: { background: backgroundColor, bubbles: randomAccentColor }, 

                avatarImgURL: user.user.displayAvatarURL({ extension: 'png' }),

                // 2. استخدام اللون الأزرق الثابت لباقي العناصر
                nicknameText: { content: user.user.tag, font: 'Nunito', color: hardcodedBlue },
                userStatus: userStatus,
                progressbarColor: hardcodedBlue,
                levelText: { font: 'Nunito', color: hardcodedBlue },
                rankText: { font: 'Nunito', color: hardcodedBlue },
                xpText: { font: 'Nunito', color: hardcodedBlue },
            });

            const canvasRank = await card.build();

            const attachment = new AttachmentBuilder(canvasRank.toBuffer(), { name: 'rank.png' });
            message.channel.send({ files: [attachment] });

        } catch (error) {
            console.error("Error creating rank card:", error);
            message.reply("There was an error generating the rank card.");
        }
    }
}
