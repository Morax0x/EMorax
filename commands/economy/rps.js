const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, ComponentType, Colors } = require('discord.js');
const { calculateMoraBuff } = require('../../streak-handler.js'); 

const EMOJI_MORA = '<:mora:1435647151349698621>';
const OWNER_ID = "1145327691772481577"; 
const ROCK = '🪨';
const PAPER = '📄';
const SCISSORS = '✂️';
const MOVES = [ROCK, PAPER, SCISSORS];

const MIN_BET = 20;
const MAX_BET_SOLO = 100; 
const COOLDOWN_MS = 1 * 60 * 60 * 1000; 

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
        .setDescription('لعبة حجرة ورقة مقص (فردي أو ضد شخص آخر).')
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
    aliases: ['حجرة', 'rock', 'r', 'حجره', 'ورقة', 'ورقه', 'مقص'],
    category: "Economy",
    description: "لعبة حجرة ورقة مقص.",

    async execute(interactionOrMessage, args) {
        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, user, guild, client, channel, member;
        let betInput, opponentInput;

        if (isSlash) {
            interaction = interactionOrMessage;
            user = interaction.user;
            member = interaction.member;
            guild = interaction.guild;
            client = interaction.client;
            channel = interaction.channel;
            betInput = interaction.options.getInteger('الرهان');
            opponentInput = interaction.options.getUser('الخصم');
            await interaction.deferReply();
        } else {
            message = interactionOrMessage;
            user = message.author;
            member = message.member;
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

        // تهيئة المتغيرات
        if (!client.activeGames) client.activeGames = new Set();
        if (!client.activePlayers) client.activePlayers = new Set(); // لتتبع اللاعبين النشطين

        // 1. التحقق من اللاعب النشط (لمنع السبام ولعب أكثر من لعبة)
        if (client.activePlayers.has(user.id)) {
            return reply({ content: "🚫 لديك لعبة نشطة بالفعل! أكملها أولاً.", ephemeral: true });
        }

        // 2. التحقق من القناة (لمنع التداخل)
        if (client.activeGames.has(channel.id)) {
            return reply({ content: "🚫 هناك لعبة جارية في هذه القناة. انتظر انتهائها.", ephemeral: true });
        }

        const sql = client.sql;
        let userData = client.getLevel.get(user.id, guild.id);
        if (!userData) userData = { ...client.defaultData, user: user.id, guild: guild.id };

        // 3. التحقق من الكولداون
        const now = Date.now();
        if (user.id !== OWNER_ID) {
            const timeLeft = (userData.lastRPS || 0) + COOLDOWN_MS - now;
            if (timeLeft > 0) {
                return reply({ content: `🕐 انتظر **\`${formatTime(timeLeft)}\`** قبل اللعب مرة أخرى.` });
            }
        }

        // --- المراهنة التلقائية ---
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
            
            // حجز القناة واللاعب مؤقتاً
            client.activeGames.add(channel.id);
            client.activePlayers.add(user.id);

            const filter = i => i.user.id === user.id && (i.customId === 'rps_auto_confirm' || i.customId === 'rps_auto_cancel');
            
            try {
                const confirmation = await confirmMsg.awaitMessageComponent({ filter, time: 15000 });
                
                if (confirmation.customId === 'rps_auto_cancel') {
                    await confirmation.update({ content: '❌ تم الإلغاء.', embeds: [], components: [] });
                    client.activeGames.delete(channel.id);
                    client.activePlayers.delete(user.id);
                    return;
                }

                if (confirmation.customId === 'rps_auto_confirm') {
                    await confirmation.deferUpdate();
                    if (!isSlash) await confirmMsg.delete().catch(() => {});
                    else await confirmation.editReply({ content: '✅', embeds: [], components: [] });

                    // إزالة الحجز المؤقت لبدء اللعبة الفعلية (سيتم إعادة الحجز داخل الدالة)
                    client.activeGames.delete(channel.id);
                    client.activePlayers.delete(user.id);

                    // تمرير member بدلاً من user لحساب البفات
                    return startGame(channel, user, member, opponentInput, proposedBet, client, guild, sql, isSlash ? interaction : null);
                }
            } catch (e) {
                client.activeGames.delete(channel.id);
                client.activePlayers.delete(user.id);
                if (!isSlash) await confirmMsg.delete().catch(() => {});
                else await interaction.editReply({ content: '⏰ انتهى الوقت.', embeds: [], components: [] });
                return;
            }
        } else {
            return startGame(channel, user, member, opponentInput, betInput, client, guild, sql, isSlash ? interaction : null);
        }
    }
};

async function startGame(channel, user, member, opponent, bet, client, guild, sql, interaction) {
    if (client.activeGames.has(channel.id)) {
        const msg = "🚫 هناك لعبة جارية في هذه القناة.";
        if (interaction && !interaction.replied) await interaction.followUp({ content: msg, ephemeral: true });
        else channel.send(msg);
        return;
    }
    
    // التحقق مرة أخرى من اللاعب النشط
    if (client.activePlayers.has(user.id)) return;

    let userData = client.getLevel.get(user.id, guild.id);
    if (!userData || userData.mora < bet) {
        const msg = `❌ ليس لديك مورا كافية! (رصيدك: ${userData ? userData.mora : 0})`;
        if (interaction && !interaction.replied) await interaction.followUp({ content: msg, ephemeral: true });
        else channel.send(msg);
        return;
    }

    // --- PvP ---
    if (opponent && opponent.id !== user.id && !opponent.bot) {
        if (client.activePlayers.has(opponent.id)) {
            const msg = `🚫 اللاعب ${opponent} لديه لعبة نشطة بالفعل.`;
            if (interaction) await interaction.followUp(msg); else channel.send(msg);
            return;
        }

        let opponentData = client.getLevel.get(opponent.id, guild.id);
        if (!opponentData || opponentData.mora < bet) {
            const msg = `❌ الخصم ${opponent} لا يملك مورا كافية!`;
            if (interaction && !interaction.replied) await interaction.followUp(msg);
            else channel.send(msg);
            return;
        }

        client.activeGames.add(channel.id);
        client.activePlayers.add(user.id);
        client.activePlayers.add(opponent.id);

        const inviteEmbed = new EmbedBuilder()
            .setTitle('🥊 تحدي حجرة ورقة مقص')
            .setDescription(`${user} يتحدى ${opponent} على **${bet}** ${EMOJI_MORA}!\n\nاضغط "قبول" للبدء.`)
            .setColor("Orange");

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rps_accept').setLabel('قبول').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('rps_decline').setLabel('رفض').setStyle(ButtonStyle.Danger)
        );

        let inviteMsg;
        if (interaction && !interaction.replied) {
             inviteMsg = await interaction.editReply({ content: `${opponent}`, embeds: [inviteEmbed], components: [row] });
        } else {
             inviteMsg = await channel.send({ content: `${opponent}`, embeds: [inviteEmbed], components: [row] });
        }

        const filter = i => i.user.id === opponent.id && (i.customId === 'rps_accept' || i.customId === 'rps_decline');
        
        try {
            const response = await inviteMsg.awaitMessageComponent({ filter, time: 30000 });
            
            if (response.customId === 'rps_decline') {
                client.activeGames.delete(channel.id);
                client.activePlayers.delete(user.id);
                client.activePlayers.delete(opponent.id);
                await response.update({ content: `❌ تم رفض التحدي.`, embeds: [], components: [] });
                return;
            }

            await response.deferUpdate();
            
            userData = client.getLevel.get(user.id, guild.id);
            opponentData = client.getLevel.get(opponent.id, guild.id);
            
            if (userData.mora < bet || opponentData.mora < bet) {
                client.activeGames.delete(channel.id);
                client.activePlayers.delete(user.id);
                client.activePlayers.delete(opponent.id);
                return inviteMsg.edit({ content: "❌ أحد اللاعبين صرف أمواله قبل بدء اللعبة!", embeds: [], components: [] });
            }

            userData.mora -= bet;
            opponentData.mora -= bet;
            if (user.id !== OWNER_ID) userData.lastRPS = Date.now();
            client.setLevel.run(userData);
            client.setLevel.run(opponentData);

            await runRPSRound(inviteMsg, user, member, opponent, bet, true, client, guild, sql);

        } catch (e) {
            client.activeGames.delete(channel.id);
            client.activePlayers.delete(user.id);
            client.activePlayers.delete(opponent.id);
            await inviteMsg.edit({ content: "⏰ انتهى وقت قبول التحدي.", embeds: [], components: [] });
        }

    } else {
        // --- Solo ---
        if (opponent && opponent.bot) return channel.send("🤖 لا يمكنك تحدي البوتات في PvP، العب فردي.");
        
        if (bet > MAX_BET_SOLO) {
             const msg = `🚫 الحد الأقصى للرهان الفردي هو **${MAX_BET_SOLO}** ${EMOJI_MORA}.`;
             if (interaction && !interaction.replied) await interaction.followUp({ content: msg, ephemeral: true });
             else channel.send(msg);
             return;
        }

        client.activeGames.add(channel.id);
        client.activePlayers.add(user.id);

        userData.mora -= bet;
        if (user.id !== OWNER_ID) userData.lastRPS = Date.now();
        client.setLevel.run(userData);
        
        const initialEmbed = new EmbedBuilder()
            .setTitle('حجرة ورقة مقص!')
            .setDescription(`اختر حركتك يا ${user.username}!`)
            .setColor("Blue");
            
        const initialRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rps_rock').setEmoji(ROCK).setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('rps_paper').setEmoji(PAPER).setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('rps_scissors').setEmoji(SCISSORS).setStyle(ButtonStyle.Secondary)
        );

        let msg;
        if (interaction) {
             if (!interaction.replied) {
                msg = await interaction.editReply({ content: " ", embeds: [initialEmbed], components: [initialRow] });
             } else {
                msg = await channel.send({ content: `${user}`, embeds: [initialEmbed], components: [initialRow] });
             }
        } else {
             msg = await channel.send({ content: " ", embeds: [initialEmbed], components: [initialRow] });
        }
        
        await runRPSRound(msg, user, member, null, bet, false, client, guild, sql);
    }
}

async function runRPSRound(message, player1, member1, player2, bet, isPvP, client, guild, sql) {
    if (isPvP) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rps_rock').setEmoji(ROCK).setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('rps_paper').setEmoji(PAPER).setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('rps_scissors').setEmoji(SCISSORS).setStyle(ButtonStyle.Secondary)
        );

        const embed = new EmbedBuilder()
            .setTitle('حجرة ورقة مقص!')
            .setDescription(`اللاعبين: ${player1} vs ${player2}\nاختاروا حركتكم!`)
            .setColor("Blue");

        await message.edit({ content: " ", embeds: [embed], components: [row] });
    }

    const moves = {};
    const filter = i => {
        if (isPvP) return (i.user.id === player1.id || i.user.id === player2.id) && !moves[i.user.id];
        return i.user.id === player1.id;
    };

    const collector = message.createMessageComponentCollector({ filter, time: 30000 });

    collector.on('collect', async i => {
        await i.deferUpdate().catch(() => {}); 
        
        let move = '';
        if (i.customId === 'rps_rock') move = ROCK;
        if (i.customId === 'rps_paper') move = PAPER;
        if (i.customId === 'rps_scissors') move = SCISSORS;

        moves[i.user.id] = move;

        if (isPvP) {
            if (Object.keys(moves).length === 2) {
                collector.stop('finished');
            } else {
                await i.followUp({ content: `✅ ${i.user} اختار حركته! بانتظار الخصم...`, ephemeral: true }).catch(() => {});
            }
        } else {
            collector.stop('finished');
        }
    });

    collector.on('end', async (collected, reason) => {
        // تنظيف الحالة
        client.activeGames.delete(message.channel.id);
        client.activePlayers.delete(player1.id);
        if (player2) client.activePlayers.delete(player2.id);

        if (reason !== 'finished') {
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
            return message.edit({ content: "⏰ انتهى الوقت! تم إلغاء اللعبة وإعادة المورا.", embeds: [], components: [] }).catch(() => {});
        }

        const p1Move = moves[player1.id];
        const p2Move = isPvP ? moves[player2.id] : MOVES[Math.floor(Math.random() * MOVES.length)];

        let result; 

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
            let p1Data = client.getLevel.get(player1.id, guild.id);
            
            let winnings = 0;
            let buffString = "";

            if (isPvP) {
                winnings = bet * 2; 
                p1Data.mora += winnings;
                
                resultEmbed.setTitle(`🏆 الفائز: ${player1.displayName}!`)
                    .setColor("Green")
                    .setDescription(
                        `✶ قـام ${player1} بـ اختيـار ${p1Move}\n` +
                        `✶ قـام ${p2Name} بـ اختيـار ${p2Move}\n\n` +
                        `ربـح **${winnings.toLocaleString()}** ${EMOJI_MORA}`
                    )
                    .setThumbnail(player1.displayAvatarURL({ dynamic: true }));

            } else {
                const multiplier = calculateMoraBuff(member1, sql); 
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
                    .setThumbnail(player1.displayAvatarURL({ dynamic: true }));
            }
            client.setLevel.run(p1Data);

        } else {
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
                    .setThumbnail(player2.displayAvatarURL({ dynamic: true }));
            } else {
                resultEmbed.setTitle("💀 لقد خسرت!")
                    .setColor("Red")
                    .setDescription(
                        `✶ قـمت بـ اختيـار ${p1Move}\n` +
                        `✶ قـمـت انـا بـ اختيـار ${p2Move}\n\n` +
                        `خـسرت رهـانك (**${bet}** ${EMOJI_MORA})`
                    )
                    .setThumbnail(client.user.displayAvatarURL({ dynamic: true }));
            }
        }

        await message.edit({ content: null, embeds: [resultEmbed], components: [] }).catch(() => {});
    });
}
