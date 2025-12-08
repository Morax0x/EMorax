const { EmbedBuilder, Colors, AttachmentBuilder, SlashCommandBuilder } = require("discord.js");
const { createCanvas, loadImage } = require('canvas'); // ❌ تم حذف registerFont
const path = require('path');

const EMOJI_MORA = '<:mora:1435647151349698621>';
const INTEREST_RATE = 0.005;
const INTEREST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const LOANS = [
    { amount: 5000, totalToRepay: 5500 },
    { amount: 15000, totalToRepay: 16500 },
    { amount: 30000, totalToRepay: 33000 }
];

// ❌ تم حذف كود تسجيل الخط من هنا (موجود في index.js)

function formatTimeSimple(ms) {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('بنك')
        .setDescription('يعرض رصيدك في البنك، الفائدة اليومية، وحالة القرض.')
        .addUserOption(option => 
            option.setName('المستخدم')
            .setDescription('المستخدم الذي تريد عرض تقريره البنكي (اختياري)')
            .setRequired(false)),

    name: 'bank',
    aliases: ['قرضي','بنك'],
    category: "Economy",
    cooldown: 10,
    description: 'يعرض رصيدك في البنك، الفائدة اليومية، وحالة القرض.',

    async execute(interactionOrMessage, args) {

        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, client, guild, sql;
        let targetUser, targetMember;

        try {
            if (isSlash) {
                interaction = interactionOrMessage;
                guild = interaction.guild;
                client = interaction.client;
                sql = client.sql;

                const target = interaction.options.getUser('المستخدم') || interaction.user;
                targetUser = target;
                targetMember = await guild.members.fetch(target.id).catch(() => null);

                if (!targetMember) {
                    return interaction.reply({ content: 'لم أتمكن من العثور على هذا العضو في السيرفر.', ephemeral: true });
                }

                await interaction.deferReply();
            } else {
                message = interactionOrMessage;
                guild = message.guild;
                client = message.client;
                sql = client.sql;

                targetMember = message.mentions.members.first() || message.guild.members.cache.get(args[0]) || message.member;
                targetUser = targetMember.user;
            }

            const reply = async (payload) => {
                if (isSlash) {
                    return interaction.editReply(payload);
                } else {
                    return message.channel.send(payload);
                }
            };

            const getScore = client.getLevel;

            let data = getScore.get(targetUser.id, guild.id);
            if (!data) {
                data = { ...client.defaultData, user: targetUser.id, guild: guild.id };
            }

            // تأمين البيانات
            data.mora = data.mora || 0;
            data.bank = data.bank || 0;
            data.lastInterest = data.lastInterest || 0;
            data.totalInterestEarned = data.totalInterestEarned || 0;

            const now = Date.now();
            const timeLeft = (data.lastInterest || 0) + INTEREST_COOLDOWN_MS - now;

            let interestMessage;
            const currentInterestRate = "0.50%";

            const baseInterest = Math.floor(data.bank * INTEREST_RATE);
            const finalInterest = baseInterest;

            if (timeLeft <= 0) {
                interestMessage = `الفائدة التالية جاهزة (ستتم إضافتها قريباً).`;
            } else {
                interestMessage = `ستتم إضافة الفائدة التالية بعد: \`${formatTimeSimple(timeLeft)}\``;
            }

            const description = [
                `✥ رصـيد البنـك: **${data.bank.toLocaleString()}** ${EMOJI_MORA}`,
                `✶ رصيد الكـاش: **${data.mora.toLocaleString()}** ${EMOJI_MORA}`,
                `\n**الفوائـد اليوميـة (${currentInterestRate}):** ${finalInterest.toLocaleString()} ${EMOJI_MORA}`,
                `${interestMessage}`
            ];

            description.push('\n');

            const getLoan = sql.prepare("SELECT * FROM user_loans WHERE userID = ? AND guildID = ? AND remainingAmount > 0");
            const loan = getLoan.get(targetUser.id, guild.id);

            if (!loan) {
                description.push(`🏦 **حالة القرض:** (غير مدين)`);
                description.push(`للحصول على قرض، قدم طلبك من خلال: \`/قرض\``);
            } else {
                const loanConfig = LOANS.find(l => l.amount === loan.loanAmount);
                const totalToRepay = loanConfig ? loanConfig.totalToRepay : (loan.loanAmount * 1.10);
                
                const remaining = loan.remainingAmount || 0;
                const daily = loan.dailyPayment || 1;
                
                const daysLeft = Math.ceil(remaining / daily);

                description.push(`✥ **حـالــة القــرض 🏦:**`);
                description.push(`✬ قيـمـة القـرض: **${(loan.loanAmount || 0).toLocaleString()}** ${EMOJI_MORA}`);
                description.push(`✬ اجمـالـي القـرض: **${totalToRepay.toLocaleString()}** ${EMOJI_MORA}`);
                description.push(`✬ متبقي للسداد: **${remaining.toLocaleString()}** ${EMOJI_MORA}`);
                description.push(`✬ القسط اليومي: **${daily.toLocaleString()}** ${EMOJI_MORA}`);
                description.push(`✬ الأيام المتبقية: **${daysLeft}** يوم`);
                description.push(`للسداد المبكر وتجنب الفوائد استعمل \`/سداد\``);
            }

            let attachment;
            try {
                const canvas = createCanvas(1000, 400);
                const context = canvas.getContext('2d');

                const bgPath = path.join(__dirname, '../../images/card.png');
                const background = await loadImage(bgPath);
                context.drawImage(background, 0, 0, canvas.width, canvas.height);

                context.save();
                context.beginPath();
                context.arc(165, 200, 65, 0, Math.PI * 2, true);
                context.closePath();
                context.clip();
                const avatar = await loadImage(targetUser.displayAvatarURL({ extension: 'png' }));
                context.drawImage(avatar, 90, 125, 150, 150);
                context.restore();

                context.textAlign = 'left';
                context.fillStyle = '#E0B04A';

                // 👇 (التعديل هنا: استخدام خط Cairo الموحد)
                context.font = 'bold 48px "Cairo"';

                context.fillText(data.mora.toLocaleString(), 335, 235);
                context.fillText(data.bank.toLocaleString(), 335, 340);

                attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'mora-card.png' });

            } catch (err) {
                console.error("Error creating bank card canvas:", err);
            }

            const embed = new EmbedBuilder()
                .setColor("#F09000")
                .setTitle('✥  تـقريـرك الائتماني')
                .setThumbnail(targetUser.displayAvatarURL())
                .setDescription(description.join('\n'))
                .setTimestamp();

            if (attachment) {
                embed.setImage('attachment://mora-card.png');
                await reply({ embeds: [embed], files: [attachment] });
            } else {
                embed.setImage('https://i.postimg.cc/kMSMkvr3/download.gif');
                await reply({ embeds: [embed] });
            }

        } catch (error) {
            console.error("Error in bank command:", error);
            const errorPayload = { content: "حدث خطأ أثناء جلب التقرير البنكي.", ephemeral: true };
            if (isSlash) {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply(errorPayload);
                } else {
                    await interaction.reply(errorPayload);
                }
            } else {
                message.reply(errorPayload.content);
            }
        }
    }
};
