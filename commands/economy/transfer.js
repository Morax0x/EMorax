const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");
const TAX_RATE = 0.05; // 5%
const COOLDOWN_MS = 5 * 60 * 1000; // 5 دقائق

module.exports = {
    data: new SlashCommandBuilder()
        .setName('تحويل')
        .setDescription('تحول مورا إلى عضو آخر (مع ضريبة 5%).')
        .addUserOption(option =>
            option.setName('المستلم')
            .setDescription('العضو الذي تريد التحويل له')
            .setRequired(true))
        .addIntegerOption(option =>
            option.setName('المبلغ')
            .setDescription('المبلغ الذي تريد تحويله')
            .setRequired(true)
            .setMinValue(1)),

    name: 'transfer',
    aliases: ['تحويل', 'c'],
    category: "Economy",
    description: 'تحول مورا إلى عضو آخر (مع ضريبة 5%).',

    async execute(interactionOrMessage, args) {

        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, guild, client, sender, senderMember, sql;
        let receiver, amount;

        if (isSlash) {
            interaction = interactionOrMessage;
            guild = interaction.guild;
            client = interaction.client;
            sql = client.sql; // جلب sql
            sender = interaction.user;
            senderMember = interaction.member;
            receiver = interaction.options.getMember('المستلم');
            amount = interaction.options.getInteger('المبلغ');
            await interaction.deferReply();
        } else {
            message = interactionOrMessage;
            guild = message.guild;
            client = message.client;
            sql = client.sql; // جلب sql
            sender = message.author;
            senderMember = message.member;
            receiver = message.mentions.members.first();
            amount = parseInt(args[1]);
        }

        const reply = async (payload) => {
            if (isSlash) {
                return interaction.editReply(payload);
            } else {
                return message.channel.send(payload);
            }
        };

        const replyError = async (content) => {
            const payload = { content, ephemeral: true };
            if (isSlash) {
                return interaction.editReply(payload);
            } else {
                return message.reply(payload);
            }
        };

        if (!receiver || isNaN(amount) || amount <= 0) {
            return replyError(`طريقة التحويل الصحيحة:\n- \`/تحويل <@user> <المبلغ>\``);
        }

        if (receiver.id === sender.id) {
            return replyError("لا يمكنك التحويل لنفسك!");
        }

        // ( 🌟 الشرط الجديد: التحقق من وجود قرض على المرسل 🌟 )
        try {
            const userLoan = sql.prepare("SELECT 1 FROM user_loans WHERE userID = ? AND guildID = ? AND remainingAmount > 0").get(sender.id, guild.id);
            if (userLoan) {
                return replyError(`❌ لا يمكنك إجراء تحويلات مالية لأن لديك **قرضاً نشطاً**. يرجى سداد القرض أولاً!`);
            }
        } catch (err) {
            console.error("Loan Check Error:", err);
        }

        const getScore = client.getLevel;
        const setScore = client.setLevel;

        let senderData = getScore.get(sender.id, guild.id);
        if (!senderData) {
            senderData = { ...client.defaultData, user: sender.id, guild: guild.id };
        }

        const now = Date.now();
        const timeLeft = (senderData.lastTransfer || 0) + COOLDOWN_MS - now;

        if (timeLeft > 0) {
            const minutes = Math.floor(timeLeft / 60000);
            const seconds = Math.floor((timeLeft % 60000) / 1000);
            return replyError(`🕐 يمكنك التحويل مرة كل 5 دقائق. يرجى الانتظار **${minutes} دقيقة و ${seconds} ثانية**.`);
        }

        if (senderData.mora < amount) {
            return replyError(`ليس لديك مورا كافية لإتمام هذا التحويل! (رصيدك: ${senderData.mora})`);
        }

        let receiverData = getScore.get(receiver.id, guild.id);
        if (!receiverData) {
            receiverData = { ...client.defaultData, user: receiver.id, guild: guild.id };
        }

        const taxAmount = Math.floor(amount * TAX_RATE);
        const amountReceived = amount - taxAmount;

        senderData.mora -= amount;
        senderData.lastTransfer = now; 
        receiverData.mora = (receiverData.mora || 0) + amountReceived;

        setScore.run(senderData);
        setScore.run(receiverData);

        const embed = new EmbedBuilder()
            .setColor("Random")
            .setTitle('تـم التـحويـل بنجـاح')
            .setDescription([
                `**المرسل:** ${sender.username}`,
                `**المستلم:** ${receiver.user.username}`,
                `\n**المبلغ المُرسل:** ${amount.toLocaleString()} <:mora:1435647151349698621>`,
                `**الضريبة (5%):** ${taxAmount.toLocaleString()} <:mora:1435647151349698621>`,
                `**المبلغ المستلم:** ${amountReceived.toLocaleString()} <:mora:1435647151349698621>`
            ].join('\n'))
            .setImage('https://i.postimg.cc/vHhJTgyx/download-3.jpg')
            .setTimestamp();

        await reply({ embeds: [embed] });
    }
};
