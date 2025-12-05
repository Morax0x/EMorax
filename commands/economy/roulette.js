const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, ComponentType, Colors } = require('discord.js');
const { calculateMoraBuff } = require('../../streak-handler.js');

const EMOJI_MORA = '<:mora:1435647151349698621>';
const OWNER_ID = "1145327691772481577"; // 🔒 آيدي المالك (للتجربة بدون كولداون)
const ROCK = '🪨';
const PAPER = '📄';
const SCISSORS = '✂️';
const MOVES = [ROCK, PAPER, SCISSORS];

const MIN_BET = 20;
const COOLDOWN_MS = 1 * 60 * 60 * 1000; // 1 ساعة

// لتنسيق الوقت
function formatTime(ms) {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('حجرة')
        .setDescription('لعبة حجرة ورقة مقص فردي أو ضد شخص آخر')
        .addIntegerOption(option => 
            option.setName('الرهان')
                .setDescription('مبلغ الرهان (اختياري)')
                .setMinValue(MIN_BET)
                .setRequired(false))
        .addUserOption(option => 
            option.setName('الخصم')
                .setDescription('الشخص الذي تريد تحديه (اختياري)')
                .setRequired(false)),

    name: 'rps',
    aliases: ['حجرة', 'rock', 'r', 'ورقة', 'ورقه', 'حجره', 'مقص'],
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
            
            if (args[0] && !isNaN(parseInt(args[0]))) {
                betInput = parseInt(args[0]);
                opponentInput = message.mentions.users.first();
            } else if (message.mentions.users.first()) {
                opponentInput = message.mentions.users.first();
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

        // 1. التحقق من الكولداون (قبل كل شيء)
        const now = Date.now();
        // استثناء المالك من الكولداون
        if (user.id !== OWNER_ID) {
            const timeLeft = (userData.lastRPS || 0) + COOLDOWN_MS - now;
            if (timeLeft > 0) {
                return reply({ content: `🕐 انتظر **\`${formatTime(timeLeft)}\`** قبل اللعب مرة أخرى.` });
            }
        }

        // --- منطق المراهنة التلقائية ---
        if (!betInput) {
            let proposedBet = 100;
            const userBalance = userData.mora;

            if (userBalance < MIN_BET) return reply({ content: `❌ لا تملك مورا كافية للعب (الحد الأدنى ${MIN_BET})!`, ephemeral: true });
            if (userBalance < 100) proposedBet = userBalance;

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
            
            try {
                const confirmation = await confirmMsg.awaitMessageComponent({ filter, time: 15000 });
                if (confirmation.customId === 'rps_auto_cancel') {
                    await confirmation.update({ content: '❌ تم الإلغاء.', embeds: [], components: [] });
                    return;
                }
                await confirmation.deferUpdate();
                if (!isSlash) await confirmMsg.delete().catch(() => {}); 
                else await confirmation.editReply({ content: '✅', embeds: [], components: [] });
                
                return startGame(channel, user, opponentInput, proposedBet, client, guild, sql, isSlash ? interaction : null);

            } catch (e) {
                if (!isSlash) await confirmMsg.delete().catch(() => {});
                else await interaction.editReply({ content: '⏰ انتهى الوقت.', embeds: [], components: [] });
                return;
            }
        } else {
            return startGame(channel, user, opponentInput, betInput, client, guild, sql, isSlash ? interaction : null);
        }
    }
};

async function startGame(channel, user, opponent, bet, client, guild, sql, interaction) {
    
    let userData = client.getLevel.get(user.id, guild.id);
    if (!userData || userData.mora < bet) {
        const msg = `❌ ليس لديك مورا كافية! (رصيدك: ${userData ? userData.mora : 0})`;
        if (interaction) await interaction.followUp({ content: msg, ephemeral: true });
        else channel.send(msg);
        return;
    }

    // --- اللعب الجماعي (PvP) ---
    if (opponent && opponent.id !== user.id && !opponent.bot) {
        let opponentData = client.getLevel.get(opponent.id, guild.id);
        if (!opponentData || opponentData.mora < bet) {
            const msg = `❌ الخصم ${opponent} لا يملك مورا كافية!`;
            if (interaction) await interaction.followUp(msg);
            else channel.send(msg);
            return;
        }

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

            await response.deferUpdate();
            
            // خصم المورا من الطرفين
            userData = client.getLevel.get(user.id, guild.id);
            opponentData = client.getLevel.get(opponent.id, guild.id);
            
            if (userData.mora < bet || opponentData.mora < bet) {
                return inviteMsg.edit({ content: "❌ أحد اللاعبين صرف أمواله قبل بدء اللعبة!", embeds: [], components: [] });
            }

            userData.mora -= bet;
            // تحديث وقت الكولداون لصاحب التحدي فقط (اختياري، أو للاثنين)
            userData.lastRPS = Date.now(); 
            
            opponentData.mora -= bet;
            // opponentData.lastRPS = Date.now(); // إذا تبي تفعل الكولداون للخصم أيضاً شيل التعليق

            client.setLevel.run(userData);
            client.setLevel.run(opponentData);

            await runRPSRound(inviteMsg, user, opponent, bet, true, client, guild, sql);

        } catch (e) {
            await inviteMsg.edit({ content: "⏰ انتهى وقت قبول التحدي.", embeds: [], components: [] });
        }

    } else {
        // --- اللعب الفردي (Solo) ---
        if (opponent && opponent.bot) return channel.send("🤖 لا يمكنك تحدي البوتات في PvP، العب فردي.");
        
        userData.mora -= bet;
        userData.lastRPS = Date.now();
        client.setLevel.run(userData);
        
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
            collector.stop('finished');
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason !== 'finished') {
            // إعادة الأموال
            if (isPvP) {
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
            // تعادل
            let p1Data = client.getLevel.get(player1.id, guild.id);
            p1Data.mora += bet;
            client.setLevel.run(p1Data);
            
            if (isPvP) {
                let p2Data = client.getLevel.get(player2.id, guild.id);
                p2Data.mora += bet;
                client.setLevel.run(p2Data);
            }

            resultEmbed.setTitle("🤝 تـعــادل!")
                .setDescription(
                    `✶ قـام ${player1} بـ اختيـار ${p1Move}\n` +
                    `✶ قـام ${p2Name} بـ اختيـار ${p2Move}\n\n` +
                    `تم استرجاع المورا.`
                );
        
        } else if (result === 1) {
            // فوز الأول
            let p1Data = client.getLevel.get(player1.id, guild.id);
            
            let winnings = 0;
            let buffString = "";

            if (isPvP) {
                winnings = bet * 2; 
                p1Data.mora += winnings;
                
                // ( 🌟 الصيغة المطلوبة للجماعي 🌟 )
                resultEmbed.setTitle(`🏆 الفائز: ${player1.displayName}!`)
                    .setColor("Green")
                    .setDescription(
                        `✶ قـام ${player1} بـ اختيـار ${p1Move}\n` +
                        `✶ قـام ${p2Name} بـ اختيـار ${p2Move}\n\n` +
                        `ربـح **${winnings.toLocaleString()}** ${EMOJI_MORA}`
                    )
                    .setThumbnail(player1.displayAvatarURL());

            } else {
                // ( 🌟 الصيغة المطلوبة للفردي مع البف 🌟 )
                const multiplier = calculateMoraBuff(player1, sql);
                winnings = Math.floor((bet * 2) * multiplier); 
                
                const buffPercent = Math.round((multiplier - 1) * 100);
                if (buffPercent > 0) buffString = ` (${buffPercent}%)`;
                
                p1Data.mora += winnings;
                
                resultEmbed.setTitle(`🏆 الفائز: ${player1.displayName}!`)
                    .setColor("Green")
                    .setDescription(
                        `✶ قـمت بـ اختيـار ${p1Move}\n` +
                        `✶ قـمـت انـا بـ اختيـار ${p2Move}\n\n` +
                        `ربـحت **${winnings.toLocaleString()}** ${EMOJI_MORA} ${buffString}`
                    )
                    .setThumbnail(player1.displayAvatarURL());
            }
            client.setLevel.run(p1Data);

        } else {
            // فوز الثاني
            if (isPvP) {
                let p2Data = client.getLevel.get(player2.id, guild.id);
                const winnings = bet * 2; 
                p2Data.mora += winnings;
                client.setLevel.run(p2Data);

                resultEmbed.setTitle(`🏆 الفائز: ${player2.displayName}!`)
                    .setColor("Green")
                    .setDescription(
                        `✶ قـام ${player1} بـ اختيـار ${p1Move}\n` +
                        `✶ قـام ${p2Name} بـ اختيـار ${p2Move}\n\n` +
                        `ربـح **${winnings.toLocaleString()}** ${EMOJI_MORA}`
                    )
                    .setThumbnail(player2.displayAvatarURL());
            } else {
                // خسارة أمام البوت (فردي)
                resultEmbed.setTitle("💀 لقد خسرت!")
                    .setColor("Red")
                    .setDescription(
                        `✶ قـمت بـ اختيـار ${p1Move}\n` +
                        `✶ قـمـت انـا بـ اختيـار ${p2Move}\n\n` +
                    );
            }
        }

        await message.edit({ content: null, embeds: [resultEmbed], components: [] });
    });
}
