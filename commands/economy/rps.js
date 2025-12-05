const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, ComponentType, Colors } = require('discord.js');
const { calculateMoraBuff } = require('../../streak-handler.js'); // لاستخدامه في الفردي فقط

const EMOJI_MORA = '<:mora:1435647151349698621>';
const ROCK = '🪨';
const PAPER = '📄';
const SCISSORS = '✂️';

const MOVES = [ROCK, PAPER, SCISSORS];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('حجرة')
        .setDescription('لعبة حجرة ورقة مقص (فردي أو ضد شخص آخر).')
        .addIntegerOption(option => 
            option.setName('الرهان')
                .setDescription('مبلغ الرهان (اختياري)')
                .setMinValue(1)
                .setRequired(false))
        .addUserOption(option => 
            option.setName('الخصم')
                .setDescription('الشخص الذي تريد تحديه (اختياري)')
                .setRequired(false)),

    name: 'rps',
    aliases: ['حجرة', 'rock', 'r'],
    category: "Economy",
    description: "لعبة حجرة ورقة مقص.",

    async execute(interactionOrMessage, args) {
        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, user, guild, client, channel;
        let betInput, opponentInput;

        if (isSlash) {
            interaction = interactionOrMessage;
            user = interaction.user;
            guild = interaction.guild;
            client = interaction.client;
            channel = interaction.channel;
            betInput = interaction.options.getInteger('الرهان');
            opponentInput = interaction.options.getUser('الخصم');
            await interaction.deferReply();
        } else {
            message = interactionOrMessage;
            user = message.author;
            guild = message.guild;
            client = message.client;
            channel = message.channel;
            
            // تحليل المدخلات (مبلغ أو منشن)
            if (args[0] && !isNaN(parseInt(args[0]))) {
                betInput = parseInt(args[0]);
                opponentInput = message.mentions.users.first();
            } else if (message.mentions.users.first()) {
                opponentInput = message.mentions.users.first();
                // قد يكون المبلغ في الخانة الثانية إذا بدأ بالمنشن (نادر لكن ممكن)
                if (args[1] && !isNaN(parseInt(args[1]))) betInput = parseInt(args[1]);
            }
        }

        const reply = async (payload) => {
            if (isSlash) return interaction.editReply(payload);
            return message.channel.send(payload);
        };

        const sql = client.sql;
        let userData = client.getLevel.get(user.id, guild.id);
        if (!userData) userData = { ...client.defaultData, user: user.id, guild: guild.id };

        // --- منطق المراهنة التلقائية ---
        if (!betInput) {
            let proposedBet = 100;
            const userBalance = userData.mora;

            if (userBalance <= 0) {
                return reply({ content: `❌ لا تملك أي مورا للعب!`, ephemeral: true });
            }

            // إذا رصيده أقل من 100، يقترح كل رصيده
            if (userBalance < 100) {
                proposedBet = userBalance;
            }

            const autoBetEmbed = new EmbedBuilder()
                .setColor(Colors.Blue)
                .setDescription(
                    `✥ المـراهـنـة التلقائية بـ **${proposedBet}** ${EMOJI_MORA} ؟\n` +
                    `✥ طريقة الاستخدام لتحديد المبلغ:\n` +
                    `\`حجرة <مبلغ الرهان> [@لاعب اختياري]\``
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('rps_auto_confirm').setLabel('مـراهـنـة').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('rps_auto_cancel').setLabel('رفـض').setStyle(ButtonStyle.Danger)
            );

            const confirmMsg = await reply({ embeds: [autoBetEmbed], components: [row], fetchReply: true });
            
            const filter = i => i.user.id === user.id && (i.customId === 'rps_auto_confirm' || i.customId === 'rps_auto_cancel');
            
            // نستخدم awaitMessageComponent لانتظار ضغطة واحدة
            try {
                const confirmation = await confirmMsg.awaitMessageComponent({ filter, time: 15000 });
                
                if (confirmation.customId === 'rps_auto_cancel') {
                    await confirmation.update({ content: '❌ تم الإلغاء.', embeds: [], components: [] });
                    return;
                }

                if (confirmation.customId === 'rps_auto_confirm') {
                    // بدء اللعبة بالمبلغ المقترح
                    await confirmation.deferUpdate(); // أو update لإزالة الأزرار
                    // حذف رسالة التأكيد لترتيب الشات
                    if (!isSlash) await confirmMsg.delete().catch(() => {}); 
                    else await confirmation.editReply({ content: '✅', embeds: [], components: [] });

                    return startGame(channel, user, opponentInput, proposedBet, client, guild, sql, isSlash ? interaction : null);
                }
            } catch (e) {
                // انتهى الوقت
                if (!isSlash) await confirmMsg.delete().catch(() => {});
                else await interaction.editReply({ content: '⏰ انتهى الوقت.', embeds: [], components: [] });
                return;
            }
        } else {
            // إذا حدد المبلغ، ابدأ مباشرة
            return startGame(channel, user, opponentInput, betInput, client, guild, sql, isSlash ? interaction : null);
        }
    }
};

// --- دالة بدء اللعبة (مفصولة لتستخدم في الحالتين) ---
async function startGame(channel, user, opponent, bet, client, guild, sql, interaction) {
    
    // التحقق من الرصيد مرة أخرى (للأمان)
    let userData = client.getLevel.get(user.id, guild.id);
    if (!userData || userData.mora < bet) {
        const msg = `❌ ليس لديك مورا كافية! (رصيدك: ${userData ? userData.mora : 0})`;
        if (interaction) await interaction.followUp({ content: msg, ephemeral: true });
        else channel.send(msg);
        return;
    }

    // إذا كان ضد خصم (PvP)
    if (opponent && opponent.id !== user.id && !opponent.bot) {
        let opponentData = client.getLevel.get(opponent.id, guild.id);
        if (!opponentData || opponentData.mora < bet) {
            const msg = `❌ الخصم ${opponent} لا يملك مورا كافية!`;
            if (interaction) await interaction.followUp(msg);
            else channel.send(msg);
            return;
        }

        // إرسال طلب التحدي
        const inviteEmbed = new EmbedBuilder()
            .setTitle('🥊 تحدي حجرة ورقة مقص')
            .setDescription(`${user} يتحدى ${opponent} على **${bet}** ${EMOJI_MORA}!\n\nاضغط "قبول" للبدء.`)
            .setColor("Orange");

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rps_accept').setLabel('قبول').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('rps_decline').setLabel('رفض').setStyle(ButtonStyle.Danger)
        );

        const inviteMsg = await channel.send({ content: `${opponent}`, embeds: [inviteEmbed], components: [row] });

        const filter = i => i.user.id === opponent.id && (i.customId === 'rps_accept' || i.customId === 'rps_decline');
        
        try {
            const response = await inviteMsg.awaitMessageComponent({ filter, time: 30000 });
            
            if (response.customId === 'rps_decline') {
                await response.update({ content: `❌ تم رفض التحدي.`, embeds: [], components: [] });
                return;
            }

            // تم القبول - خصم المورا من الطرفين
            await response.deferUpdate();
            
            // تحديث البيانات قبل الخصم
            userData = client.getLevel.get(user.id, guild.id);
            opponentData = client.getLevel.get(opponent.id, guild.id);
            
            if (userData.mora < bet || opponentData.mora < bet) {
                return inviteMsg.edit({ content: "❌ أحد اللاعبين صرف أمواله قبل بدء اللعبة!", embeds: [], components: [] });
            }

            userData.mora -= bet;
            opponentData.mora -= bet;
            client.setLevel.run(userData);
            client.setLevel.run(opponentData);

            // بدء جولة اللعب
            await runRPSRound(inviteMsg, user, opponent, bet, true, client, guild, sql);

        } catch (e) {
            await inviteMsg.edit({ content: "⏰ انتهى وقت قبول التحدي.", embeds: [], components: [] });
        }

    } else {
        // لعب فردي (ضد البوت)
        if (opponent && opponent.bot) return channel.send("🤖 لا يمكنك تحدي البوتات في PvP، العب فردي.");
        
        userData.mora -= bet;
        client.setLevel.run(userData);
        
        // نرسل رسالة جديدة للعب
        const msg = interaction ? await interaction.followUp({ content: "جاري بدء اللعبة...", fetchReply: true }) : await channel.send("جاري بدء اللعبة...");
        await runRPSRound(msg, user, null, bet, false, client, guild, sql);
    }
}

async function runRPSRound(message, player1, player2, bet, isPvP, client, guild, sql) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rps_rock').setEmoji(ROCK).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('rps_paper').setEmoji(PAPER).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('rps_scissors').setEmoji(SCISSORS).setStyle(ButtonStyle.Secondary)
    );

    const embed = new EmbedBuilder()
        .setTitle('حجرة ورقة مقص!')
        .setDescription(isPvP ? `اللاعبين: ${player1} vs ${player2}\nاختاروا حركتكم!` : `اختر حركتك يا ${player1.username}!`)
        .setColor("Blue");

    await message.edit({ content: " ", embeds: [embed], components: [row] });

    const moves = {};
    const filter = i => {
        if (isPvP) return (i.user.id === player1.id || i.user.id === player2.id) && !moves[i.user.id];
        return i.user.id === player1.id;
    };

    const collector = message.createMessageComponentCollector({ filter, time: 30000 });

    collector.on('collect', async i => {
        await i.deferUpdate();
        
        let move = '';
        if (i.customId === 'rps_rock') move = ROCK;
        if (i.customId === 'rps_paper') move = PAPER;
        if (i.customId === 'rps_scissors') move = SCISSORS;

        moves[i.user.id] = move;

        if (isPvP) {
            if (Object.keys(moves).length === 2) {
                collector.stop('finished');
            } else {
                await i.followUp({ content: `✅ ${i.user} اختار حركته! بانتظار الخصم...`, ephemeral: true });
            }
        } else {
            // فردي: البوت يختار فوراً
            collector.stop('finished');
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason !== 'finished') {
            // إعادة الأموال في حال انتهاء الوقت
            if (isPvP) {
                // إرجاع للاثنين إذا لم يكتمل
                // (يمكن تحسينه لإعطاء الفوز لمن لعب، لكن للتبسيط نعيد للكل)
                let p1Data = client.getLevel.get(player1.id, guild.id);
                let p2Data = client.getLevel.get(player2.id, guild.id);
                p1Data.mora += bet;
                p2Data.mora += bet;
                client.setLevel.run(p1Data);
                client.setLevel.run(p2Data);
            } else {
                let p1Data = client.getLevel.get(player1.id, guild.id);
                p1Data.mora += bet;
                client.setLevel.run(p1Data);
            }
            return message.edit({ content: "⏰ انتهى الوقت! تم إلغاء اللعبة وإعادة المورا.", embeds: [], components: [] });
        }

        const p1Move = moves[player1.id];
        const p2Move = isPvP ? moves[player2.id] : MOVES[Math.floor(Math.random() * MOVES.length)];

        let result; // 0: تعادل, 1: فوز الأول, 2: فوز الثاني

        if (p1Move === p2Move) result = 0;
        else if (
            (p1Move === ROCK && p2Move === SCISSORS) ||
            (p1Move === PAPER && p2Move === ROCK) ||
            (p1Move === SCISSORS && p2Move === PAPER)
        ) result = 1;
        else result = 2;

        let resultEmbed = new EmbedBuilder().setColor("Gold");
        let p2Name = isPvP ? player2.displayName : "البوت";

        if (result === 0) {
            // تعادل - إرجاع الرهان
            let p1Data = client.getLevel.get(player1.id, guild.id);
            p1Data.mora += bet;
            client.setLevel.run(p1Data);
            
            if (isPvP) {
                let p2Data = client.getLevel.get(player2.id, guild.id);
                p2Data.mora += bet;
                client.setLevel.run(p2Data);
            }

            resultEmbed.setTitle("🤝 تـعــادل!")
                .setDescription(`${player1}: ${p1Move}\n${p2Name}: ${p2Move}\n\nتم استرجاع المورا.`);
        
        } else if (result === 1) {
            // فوز اللاعب الأول
            let p1Data = client.getLevel.get(player1.id, guild.id);
            
            // 🌟 حساب الجائزة 🌟
            let winnings = 0;
            let buffText = "";

            if (isPvP) {
                // في الجماعي: الفوز بالمبلغ المتجمع فقط (بدون بفات)
                winnings = bet * 2; 
                p1Data.mora += winnings;
            } else {
                // في الفردي: الفوز + البفات
                const multiplier = calculateMoraBuff(player1, sql); // (موجودة فقط للفردي)
                winnings = Math.floor((bet * 2) * multiplier); // استرجاع الرهان + الربح * المضاعف
                
                const bonus = winnings - (bet * 2);
                if (bonus > 0) buffText = ` (+${bonus} بونص)`;
                
                p1Data.mora += winnings;
            }
            client.setLevel.run(p1Data);

            resultEmbed.setTitle(`🏆 الفائز: ${player1.displayName}!`)
                .setColor("Green")
                .setDescription(`${player1}: ${p1Move}\n${p2Name}: ${p2Move}\n\n🎉 ربح **${winnings.toLocaleString()}** ${EMOJI_MORA}${buffText}`);

        } else {
            // فوز الثاني (أو البوت)
            if (isPvP) {
                let p2Data = client.getLevel.get(player2.id, guild.id);
                const winnings = bet * 2; // بدون بفات للجماعي
                p2Data.mora += winnings;
                client.setLevel.run(p2Data);

                resultEmbed.setTitle(`🏆 الفائز: ${player2.displayName}!`)
                    .setColor("Green")
                    .setDescription(`${player1}: ${p1Move}\n${p2Name}: ${p2Move}\n\n🎉 ربح **${winnings.toLocaleString()}** ${EMOJI_MORA}`);
            } else {
                // خسارة أمام البوت
                resultEmbed.setTitle("💀 لقد خسرت!")
                    .setColor("Red")
                    .setDescription(`${player1}: ${p1Move}\n${p2Name}: ${p2Move}\n\n💸 ذهب الرهان (**${bet}** ${EMOJI_MORA}) للبوت.`);
            }
        }

        await message.edit({ content: null, embeds: [resultEmbed], components: [] });
    });
}
