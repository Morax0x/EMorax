const { EmbedBuilder, Colors, SlashCommandBuilder } = require("discord.js");
const { calculateMoraBuff } = require('../../streak-handler.js');

const REWARDS = {
    1: { min: 100, max: 150 },
    2: { min: 150, max: 200 },
    3: { min: 200, max: 300 },
    4: { min: 300, max: 450 },
    5: { min: 450, max: 600 },
    6: { min: 600, max: 800 },
    7: { min: 800, max: 1000 } 
};
const MAX_STREAK_DAY = 7;

function getRandomAmount(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// دالة لمعرفة التاريخ الحالي بتوقيت السعودية (UTC+3) كنص (YYYY-MM-DD)
function getKSADateString(timestamp) {
    return new Date(timestamp).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
}

// دالة لحساب الوقت المتبقي حتى منتصف الليل بتوقيت السعودية
function getTimeUntilNextMidnightKSA() {
    const now = new Date();
    // الحصول على الوقت الحالي في السعودية
    const ksaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }));
    
    const nextMidnight = new Date(ksaTime);
    nextMidnight.setHours(24, 0, 0, 0); // ضبط الوقت لمنتصف الليل القادم
    
    return nextMidnight.getTime() - ksaTime.getTime();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('راتب')
        .setDescription('احصل على راتبك اليومي (يتجدد الساعة 12 ص بتوقيت السعودية).'),

    name: 'daily',
    aliases: ['راتب', 'يومي', 'd', 'جائزة', 'جائزه'],
    category: "Economy",
    description: "احصل على راتبك اليومي (يتجدد الساعة 12 ص بتوقيت السعودية).",

    async execute(interactionOrMessage, args) {

        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, client, guild, user, member;

        if (isSlash) {
            interaction = interactionOrMessage;
            member = interaction.member;
            user = interaction.user;
            guild = interaction.guild;
            client = interaction.client;
            await interaction.deferReply();
        } else {
            message = interactionOrMessage;
            member = message.member;
            user = message.author;
            guild = message.guild;
            client = message.client;
        }

        const reply = async (payload) => {
            if (isSlash) {
                return interaction.editReply(payload);
            } else {
                return message.channel.send(payload);
            }
        };

        const sql = client.sql;
        const getScore = client.getLevel;
        const setScore = client.setLevel;

        let data = getScore.get(user.id, guild.id);
        if (!data) {
            data = { ...client.defaultData, user: user.id, guild: guild.id };
        }

        const now = Date.now();
        const lastDaily = data.lastDaily || 0;

        // 1. التحقق من التاريخ (بتوقيت السعودية)
        const todayKSA = getKSADateString(now);
        const lastDailyKSA = getKSADateString(lastDaily);

        if (todayKSA === lastDailyKSA) {
            const timeLeft = getTimeUntilNextMidnightKSA();
            const hours = Math.floor(timeLeft / 3600000);
            const minutes = Math.floor((timeLeft % 3600000) / 60000);
            const seconds = Math.floor((timeLeft % 60000) / 1000);
            
            const replyContent = `🕐 لقد استلمت راتبك اليوم بالفعل.\nيعود الراتب القادم خلال: **${hours} ساعة و ${minutes} دقيقة و ${seconds} ثانية** (بتوقيت السعودية).`;

            if (isSlash) return interaction.editReply({ content: replyContent, ephemeral: true });
            return message.reply(replyContent);
        }

        // 2. حساب الستريك
        let newStreak = data.dailyStreak || 0;
        
        // نحسب الفرق بالأيام بين اليوم وآخر استلام لمعرفة إذا انقطع الستريك
        const dayDifference = (new Date(todayKSA) - new Date(lastDailyKSA)) / (1000 * 60 * 60 * 24);

        if (dayDifference === 1) {
            // استلم بالأمس، نزيد الستريك
            newStreak += 1;
        } else {
            // انقطع الستريك (أو أول مرة)
            newStreak = 1;
        }

        if (newStreak > MAX_STREAK_DAY) {
            newStreak = 1; // إعادة الستريك بعد الوصول للحد الأقصى (اختياري، أو يمكن تثبيته على 7)
            // في الكود القديم كان يعيد للواحد، سأبقيه كما هو.
        }

        const rewardRange = REWARDS[newStreak] || REWARDS[MAX_STREAK_DAY];
        const baseAmount = getRandomAmount(rewardRange.min, rewardRange.max);

        const moraMultiplier = calculateMoraBuff(member, sql);
        const finalAmount = Math.floor(baseAmount * moraMultiplier);

        data.mora = (data.mora || 0) + finalAmount;
        data.lastDaily = now;
        data.dailyStreak = newStreak;

        setScore.run(data);

        let descriptionLines;
        let buffString = "";
        const buffPercent = (moraMultiplier - 1) * 100;

        if (buffPercent > 0) {
            buffString = ` (+${buffPercent.toFixed(0)}%)`;
        } else if (buffPercent < 0) {
            buffString = ` (${buffPercent.toFixed(0)}%)`;
        }

        // إعداد الرسالة (تم إزالة سطر الجائزة الكبرى)
        descriptionLines = [
            `✥ استلـمـت جـائـزتـك اليـوميـة`,
            `✶ حـصـلـت عـلـى **${finalAmount}** <:mora:1435647151349698621>${buffString}`,
            `- أنت في اليوم **${newStreak}** على التوالـي!`
        ];

        const embed = new EmbedBuilder()
            .setColor(Colors.Gold)
            .setTitle('💰 جـائـزتـك اليومـيـة')
            .setThumbnail(user.displayAvatarURL())
            .setDescription(descriptionLines.join('\n'))
            .setTimestamp();

        await reply({ embeds: [embed] });
    }
};
