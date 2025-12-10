const { EmbedBuilder, Colors, SlashCommandBuilder } = require("discord.js");
const EMOJI_MORA = '<:mora:1435647151349698621>';
const COOLDOWN_MS = 5 * 60 * 1000; // 5 دقائق

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deposit')
        .setDescription('إيداع المورا من رصيدك إلى البنك.')
        .addStringOption(option =>
            option.setName('amount')
                .setDescription('المبلغ الذي تريد إيداعه (اكتب "الكل" لإيداع كل شيء)')
                .setRequired(true)),

    name: 'deposit',
    aliases: ['ايداع', 'dep'],
    category: "Economy",
    description: 'إيداع المورا من رصيدك إلى البنك لكسب الفائدة.',

    async execute(interactionOrMessage, args) {

        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, client, guild, user;
        let amountArg;

        try {
            if (isSlash) {
                interaction = interactionOrMessage;
                client = interaction.client;
                guild = interaction.guild;
                user = interaction.user;
                amountArg = interaction.options.getString('amount');
                await interaction.deferReply();
            } else {
                message = interactionOrMessage;
                client = message.client;
                guild = message.guild;
                user = message.author;
                amountArg = args[0];
            }

            const reply = async (payload) => {
                if (isSlash) {
                    return interaction.editReply(payload);
                } else {
                    return message.channel.send(payload);
                }
            };

            const getScore = client.getLevel;
            const setScore = client.setLevel;

            let data = getScore.get(user.id, guild.id);
            if (!data) {
                data = { ...client.defaultData, user: user.id, guild: guild.id };
            }

            const now = Date.now();
            const timeLeft = (data.lastDeposit || 0) + COOLDOWN_MS - now;

            if (timeLeft > 0) {
                const minutes = Math.floor(timeLeft / 60000);
                const seconds = Math.floor((timeLeft % 60000) / 1000);
                const replyContent = `🕐 يمكنك الإيداع مرة واحدة كل 5 دقائق. يرجى الانتظار **${minutes} دقيقة و ${seconds} ثانية**.`;

                if (isSlash) {
                    return interaction.editReply({ content: replyContent, ephemeral: true });
                } else {
                    return message.reply(replyContent);
                }
            }

            let amountToDeposit;
            const userMora = data.mora || 0;

            if (!amountArg || amountArg.toLowerCase() === 'all' || amountArg.toLowerCase() === 'الكل') {
                amountToDeposit = userMora;
            } else {
                amountToDeposit = parseInt(amountArg.replace(/,/g, '')); 
            }

            if (isNaN(amountToDeposit)) {
                const replyContent = `الاستخدام: \`/ايداع المبلغ: <المبلغ | الكل>\` (المبلغ الذي أدخلته ليس رقماً).`;
                return isSlash ? interaction.editReply({ content: replyContent, ephemeral: true }) : message.reply(replyContent);
            }

            if (amountToDeposit <= 0) {
                 const replyContent = `ليس لديك أي مورا في رصيدك لإيداعها!`;
                 return isSlash ? interaction.editReply({ content: replyContent, ephemeral: true }) : message.reply(replyContent);
            }

            if (userMora < amountToDeposit) {
                const replyContent = `ليس لديك هذا المبلغ في رصيدك لإيداعه! (رصيدك: ${userMora.toLocaleString()} ${EMOJI_MORA})`;
                return isSlash ? interaction.editReply({ content: replyContent, ephemeral: true }) : message.reply(replyContent);
            }

            // تنفيذ العملية
            data.mora -= amountToDeposit;
            data.bank = (data.bank || 0) + amountToDeposit;
            data.lastDeposit = now; 

            setScore.run(data);

            // حساب الفائدة المتوقعة (0.05% = 0.0005)
            const interestAmount = Math.floor(data.bank * 0.0005);

            const embed = new EmbedBuilder()
                .setColor("Random") // لون عشوائي كما طلبت
                .setTitle('✶ تـم الايداع !')
                .setThumbnail(user.displayAvatarURL()) // صورة البروفايل المصغرة
                .setDescription(
                    `❖ تـم ايـداع: **${amountToDeposit.toLocaleString()}** ${EMOJI_MORA}\n` +
                    `❖ رصـيد البـنك: **${data.bank.toLocaleString()}** ${EMOJI_MORA}\n` +
                    `❖ رصـيـدك الكـاش: **${data.mora.toLocaleString()}** ${EMOJI_MORA}\n\n` +
                    `◇ ستـحـصـل عـلى فـائـدة يوميـة بمقدار 0.05% : **${interestAmount.toLocaleString()}** ${EMOJI_MORA}\n` +
                    `◇ وسنحمـي اموالك بنسبة اكبر من السرقـة`
                );

            await reply({ embeds: [embed] });

        } catch (error) {
            console.error("Error in deposit command:", error);
            const errorPayload = { content: "حدث خطأ أثناء عملية الإيداع.", ephemeral: true };
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
