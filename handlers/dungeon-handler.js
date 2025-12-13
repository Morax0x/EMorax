const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ComponentType } = require('discord.js');
const dungeonConfig = require('../json/dungeon-config.json');

// --- 🛠️ دوال مساعدة للتصميم (مثل PvP) ---

// رسم شريط الصحة (Health Bar)
function drawHealthBar(current, max) {
    const totalBars = 10;
    const percentage = Math.max(0, Math.min(current / max, 1));
    const filledBars = Math.round(percentage * totalBars);
    const emptyBars = totalBars - filledBars;
    
    const filledChar = '🟩';
    const emptyChar = '⬛';
    
    if (percentage <= 0.3) return '🟥'.repeat(filledBars) + emptyChar.repeat(emptyBars); // أحمر للخطر
    if (percentage <= 0.6) return '🟨'.repeat(filledBars) + emptyChar.repeat(emptyBars); // أصفر للمتوسط
    return filledChar.repeat(filledBars) + emptyChar.repeat(emptyBars);
}

// حساب قوة اللاعب (يدمج السلاح والمهارات)
function calculatePlayerPower(member, sql) {
    const weaponData = sql.prepare("SELECT * FROM user_weapons WHERE userID = ?").get(member.id);
    // القيم الأساسية
    let stats = { 
        hp: 100, 
        maxHp: 100,
        atk: 15, 
        def: 0,
        name: member.displayName, 
        id: member.id, 
        avatar: member.user.displayAvatarURL(),
        isDead: false, 
        defending: false,
        potions: 2 // عدد الجرعات المسموح بها
    }; 
    
    if (weaponData) {
        // كل لفل سلاح يزيد القوة والصحة بشكل ملحوظ
        stats.atk += (weaponData.weaponLevel * 8); 
        stats.hp += (weaponData.weaponLevel * 15);
        stats.maxHp += (weaponData.weaponLevel * 15);
    }
    return stats;
}

// اختيار وحش عشوائي من الكونفق
function getRandomMonster(type, theme) {
    let pool = [];
    if (type === 'boss') pool = dungeonConfig.monsters.bosses;
    else if (type === 'elite' || type === 'guardian') pool = dungeonConfig.monsters.elites;
    else pool = dungeonConfig.monsters.minions;

    const name = pool[Math.floor(Math.random() * pool.length)];
    return { name, emoji: theme.emoji };
}

// 🧠 ذكاء الوحش
function getMonsterAction(monster, players, type) {
    const alivePlayers = players.filter(p => !p.isDead);
    if (alivePlayers.length === 0) return { type: 'win' };

    // استراتيجيات
    const weakTarget = alivePlayers.sort((a, b) => a.hp - b.hp)[0]; 
    const randomTarget = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];

    // 1. الزعماء (Bosses)
    if (type === 'boss' || type === 'guardian') {
        // مهارة "الغضب" عند 40% صحة
        if (monster.hp < monster.maxHp * 0.4 && !monster.enraged) {
            monster.enraged = true;
            return { type: 'enrage', msg: `💢 **${monster.name}** دخل في حالة هيجان! (ATK x1.5)` };
        }
        // ضربة جماعية (AOE) بنسبة 25%
        if (Math.random() < 0.25) {
            return { type: 'aoe', target: alivePlayers, multiplier: 0.6 };
        }
        // ضربة قاضية للهدف الضعيف
        if (weakTarget.hp < monster.atk && Math.random() < 0.5) {
            return { type: 'attack', target: weakTarget, multiplier: 1.5, msg: `☠️ **${monster.name}** يحاول إعدام ${weakTarget.name}!` };
        }
    }

    // هجوم عادي
    return { type: 'attack', target: randomTarget, multiplier: 1 };
}

// ==================================================================
// 🎮 1. بداية الدانجون (اختيار العالم)
// ==================================================================
async function startDungeon(interaction, sql) {
    const user = interaction.user;
    
    const themeOptions = Object.keys(dungeonConfig.themes).map(key => ({
        label: dungeonConfig.themes[key].name,
        value: key,
        emoji: dungeonConfig.themes[key].emoji
    }));

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('dungeon_theme').setPlaceholder('🌍 اختر عالم الدانجون...').addOptions(themeOptions)
    );

    const embed = new EmbedBuilder()
        .setTitle(`⚔️ بوابة الدانجون`)
        .setDescription(`مرحباً بك أيها المغامر **${user.username}**.\nاختر المنطقة التي تود استكشافها مع فريقك.`)
        .setColor('#2F3136')
        .setImage('https://media.discordapp.net/attachments/1145327691772481577/1169000000000000000/dungeon_gate.gif'); // صورة اختيارية

    let msg;
    if (interaction.isChatInputCommand) {
        msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
    } else {
        msg = await interaction.reply({ embeds: [embed], components: [row] });
    }

    const filter = i => i.user.id === user.id && i.customId === 'dungeon_theme';
    try {
        const selection = await msg.awaitMessageComponent({ filter, time: 30000 });
        const themeKey = selection.values[0];
        const theme = dungeonConfig.themes[themeKey];
        await lobbyPhase(selection, theme, sql);
    } catch (e) {
        // انتهاء الوقت
        if (msg.editable) msg.edit({ content: "⏰ انتهى وقت اختيار البوابة.", components: [], embeds: [] }).catch(()=>{});
    }
}

// ==================================================================
// 👥 2. اللوبي (تجميع الفريق)
// ==================================================================
async function lobbyPhase(interaction, theme, sql) {
    const host = interaction.user;
    let party = [host.id];
    
    const updateEmbed = () => {
        const memberList = party.map((id, i) => `\`${i+1}.\` <@${id}> ${id === host.id ? '👑' : ''}`).join('\n');
        return new EmbedBuilder()
            .setTitle(`${theme.emoji} تجهيز الفريق: ${theme.name}`)
            .setDescription(`**القائد:** ${host}\n**السعر:** 💰 100 مورا/شخص\n\n👥 **المغامرون (${party.length}/5):**\n${memberList}\n\n*اضغط "انضمام" للدخول، و "انطلاق" عند الجاهزية.*`)
            .setColor('Gold')
            .setThumbnail(host.displayAvatarURL());
    };

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('join').setLabel('انضمام').setEmoji('➕').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('start').setLabel('انطلاق').setEmoji('⚔️').setStyle(ButtonStyle.Danger)
    );

    await interaction.update({ content: null, embeds: [updateEmbed()], components: [row] });
    const msg = await interaction.message;

    const collector = msg.createMessageComponentCollector({ time: 60000 });

    collector.on('collect', async i => {
        if (i.customId === 'join') {
            if (party.includes(i.user.id)) return i.reply({ content: "⚠️ أنت منضم بالفعل!", ephemeral: true });
            if (party.length >= 5) return i.reply({ content: "🚫 الفريق ممتلئ (الحد الأقصى 5).", ephemeral: true });
            
            // التحقق من الرصيد
            const userMora = sql.prepare("SELECT mora FROM levels WHERE user = ?").get(i.user.id)?.mora || 0;
            if (userMora < 100) return i.reply({ content: "❌ لا تملك 100 مورا للدخول.", ephemeral: true });
            
            party.push(i.user.id);
            await i.update({ embeds: [updateEmbed()] });
        } 
        else if (i.customId === 'start') {
            if (i.user.id !== host.id) return i.reply({ content: "⛔ فقط قائد الفريق يمكنه بدء الدانجون.", ephemeral: true });
            collector.stop('start');
        }
    });

    collector.on('end', async (c, reason) => {
        if (reason === 'start') {
            // خصم المورا وبدء اللعبة
            party.forEach(id => sql.prepare("UPDATE levels SET mora = mora - 100 WHERE user = ?").run(id));
            await runDungeon(interaction, party, theme, sql);
        } else {
            const cancelEmbed = new EmbedBuilder().setDescription("❌ تم إلغاء الدانجون لعدم البدء في الوقت المحدد.").setColor('Red');
            if (msg.editable) msg.edit({ embeds: [cancelEmbed], components: [] }).catch(()=>{});
        }
    });
}

// ==================================================================
// ⚔️ 3. نظام القتال (The Battle)
// ==================================================================
async function runDungeon(interaction, partyIDs, theme, sql) {
    const channel = interaction.channel;
    const guild = interaction.guild;
    
    // 1. تجهيز اللاعبين
    let players = [];
    for (const id of partyIDs) {
        const m = await guild.members.fetch(id).catch(()=>null);
        if (m) players.push(calculatePlayerPower(m, sql));
    }

    if (players.length === 0) return channel.send("❌ فشل تحميل بيانات اللاعبين.");

    // حلقة الـ 10 طوابق
    for (let floor = 1; floor <= 10; floor++) {
        if (players.every(p => p.isDead)) break; // خسارة الفريق

        const floorConfig = dungeonConfig.floors.find(f => f.floor === floor) || dungeonConfig.floors[0];
        const randomMob = getRandomMonster(floorConfig.type, theme);
        
        // موازنة الوحش (يصبح أقوى كلما زاد عدد اللاعبين)
        const hpMult = players.length * 0.8 + 0.2; // معادلة لتقليل الصعوبة قليلاً مع العدد
        
        let monster = {
            name: `${randomMob.name}`,
            hp: Math.floor(100 * floorConfig.hp_mult * hpMult),
            maxHp: Math.floor(100 * floorConfig.hp_mult * hpMult),
            atk: Math.floor(10 * floorConfig.atk_mult),
            enraged: false,
            turn: 0
        };

        let log = [`⚠️ **الطابق ${floor}**: ظهر وحش **${monster.name}**! استعدوا للقتال!`];
        let ongoing = true;

        // رسالة المعركة الأولى
        const battleMsg = await channel.send({ 
            embeds: [generateBattleEmbed(players, monster, floor, theme, log)], 
            components: [generateBattleRow()] 
        });

        // حلقة الجولات داخل الطابق
        while (ongoing) {
            // انتظار ردود اللاعبين (5 ثواني لكل جولة لتسريع اللعب)
            const collector = battleMsg.createMessageComponentCollector({ time: 5000 });
            let actedPlayers = [];

            await new Promise(resolve => {
                collector.on('collect', async i => {
                    const p = players.find(pl => pl.id === i.user.id);
                    if (!p || p.isDead || actedPlayers.includes(p.id)) return i.deferUpdate();
                    
                    actedPlayers.push(p.id);
                    await i.deferUpdate();

                    // منطق اللاعب
                    if (i.customId === 'atk') {
                        // الكريتيكال
                        const isCrit = Math.random() < 0.2; // 20% فرصة
                        let dmg = Math.floor(p.atk * (0.9 + Math.random() * 0.2));
                        if (isCrit) dmg = Math.floor(dmg * 1.5);
                        
                        monster.hp -= dmg;
                        log.push(`🗡️ **${p.name}** ${isCrit ? '**CRIT!**' : ''} سبب ${dmg} ضرر.`);
                    } 
                    else if (i.customId === 'heal') {
                        if (p.potions > 0) {
                            const heal = Math.floor(p.maxHp * 0.4); // علاج 40%
                            p.hp = Math.min(p.hp + heal, p.maxHp);
                            p.potions--;
                            log.push(`🧪 **${p.name}** شرب جرعة (+${heal} HP).`);
                        } else {
                            log.push(`⚠️ **${p.name}** نفذت جرعاته!`);
                        }
                    } 
                    else if (i.customId === 'def') {
                        p.defending = true;
                        log.push(`🛡️ **${p.name}** اتخذ وضعية الدفاع.`);
                    }
                });
                collector.on('end', resolve);
            });

            // 1. هل مات الوحش؟
            if (monster.hp <= 0) {
                ongoing = false;
                
                // 🔥🔥 حساب البونص بناءً على مستوى بوابة القائد 🔥🔥
                const hostData = sql.prepare("SELECT dungeon_gate_level FROM levels WHERE user = ?").get(partyIDs[0]);
                const gateLevel = hostData?.dungeon_gate_level || 1;
                // كل مستوى يزيد الجوائز بنسبة 10%
                const bonusMultiplier = 1 + ((gateLevel - 1) * 0.1); 

                const xp = Math.floor(floorConfig.xp * bonusMultiplier);
                const mora = Math.floor(floorConfig.mora * bonusMultiplier);

                players.filter(p => !p.isDead).forEach(p => {
                    sql.prepare("UPDATE levels SET xp = xp + ?, mora = mora + ? WHERE user = ?").run(xp, mora, p.id);
                    // تحديث أعلى طابق
                    const currentMax = sql.prepare("SELECT max_dungeon_floor FROM levels WHERE user = ?").get(p.id)?.max_dungeon_floor || 0;
                    if (floor > currentMax) sql.prepare("UPDATE levels SET max_dungeon_floor = ? WHERE user = ?").run(floor, p.id);
                });

                log.push(`🎉 **${monster.name} هُزم!** (+${mora}💰 +${xp}✨)`);
                if (gateLevel > 1) log.push(`💎 **بونص البوابة (Lv.${gateLevel}):** x${bonusMultiplier.toFixed(1)}`);

                await battleMsg.edit({ embeds: [generateBattleEmbed(players, monster, floor, theme, log, 'Green')], components: [] });
                
                // استراحة وإنعاش بسيط
                players.forEach(p => { 
                    if(!p.isDead) p.hp = Math.min(p.hp + Math.floor(p.maxHp * 0.2), p.maxHp); 
                    p.defending = false; // إلغاء الدفاع
                });
                
                await new Promise(r => setTimeout(r, 2500)); // انتظار قبل الطابق التالي
                continue; // الانتقال للطابق التالي
            }

            // 2. دور الوحش
            monster.turn++;
            const action = getMonsterAction(monster, players, floorConfig.type);
            
            if (action.type === 'attack') {
                let dmg = Math.floor(monster.atk * action.multiplier);
                if (action.target.defending) dmg = Math.floor(dmg * 0.5); // الدفاع يقلل الضرر 50%
                
                action.target.hp -= dmg;
                log.push(action.msg || `👹 **${monster.name}** ضرب **${action.target.name}** بـ ${dmg} ضرر.`);
                
                if (action.target.hp <= 0) {
                    action.target.hp = 0;
                    action.target.isDead = true;
                    log.push(`💀 **${action.target.name}** سقط في المعركة!`);
                }
            } 
            else if (action.type === 'aoe') {
                log.push(`🔥 **${monster.name}** أطلق هجوماً جماعياً!`);
                players.filter(p => !p.isDead).forEach(p => {
                    let dmg = Math.floor(monster.atk * 0.7);
                    if (p.defending) dmg = Math.floor(dmg * 0.5);
                    p.hp -= dmg;
                    if (p.hp <= 0) {
                        p.hp = 0;
                        p.isDead = true;
                        log.push(`💀 **${p.name}** مات!`);
                    }
                });
            }
            else if (action.type === 'enrage') {
                monster.atk = Math.floor(monster.atk * 1.5);
                log.push(action.msg);
            }

            // 3. هل مات الفريق؟
            if (players.every(p => p.isDead)) {
                ongoing = false;
                log.push(`☠️ **تم القضاء على الفريق...** انتهت الرحلة.`);
                await battleMsg.edit({ embeds: [generateBattleEmbed(players, monster, floor, theme, log, 'Red')], components: [] });
                return;
            }

            // تحديث الرسالة للجولة القادمة
            players.forEach(p => p.defending = false); // إعادة ضبط الدفاع
            
            // الاحتفاظ بآخر 7 أسطر فقط في اللوج لتجنب الامتلاء
            if (log.length > 7) log = log.slice(-7);
            
            await battleMsg.edit({ embeds: [generateBattleEmbed(players, monster, floor, theme, log)] });
        }
    }
    
    // إذا وصلوا هنا، يعني فازوا بجميع الطوابق
    channel.send(`🏆 **أداء أسطوري!** لقد أنهيتم الدانجون بالكامل (10 طوابق)!`);
}

// --- 🎨 تصميم الايمبد (يشبه PvP) ---
function generateBattleEmbed(players, monster, floor, theme, log, color = '#2F3136') {
    const embed = new EmbedBuilder()
        .setTitle(`${theme.emoji} الطابق ${floor} | ضد ${monster.name}`)
        .setColor(color);

    // قسم الوحش (يمين/فوق)
    const monsterHealth = drawHealthBar(monster.hp, monster.maxHp);
    embed.addFields({
        name: `👹 **${monster.name}** ${monster.enraged ? '🔥(HYPE)' : ''}`,
        value: `${monsterHealth} \`[${monster.hp}/${monster.maxHp}]\``,
        inline: false
    });

    // قسم الفريق (يسار/تحت)
    let teamStatus = players.map(p => {
        const icon = p.isDead ? '💀' : (p.defending ? '🛡️' : '❤️');
        const hpBar = p.isDead ? 'MORT' : `\`${p.hp}/${p.maxHp}\``;
        return `${icon} **${p.name}**: ${hpBar}`;
    }).join('\n');

    embed.addFields({ name: `🛡️ **فريق المغامرين**`, value: teamStatus, inline: false });

    // اللوج (سجل المعركة)
    embed.setDescription(`\`\`\`diff\n${log.join('\n')}\n\`\`\``);

    return embed;
}

// أزرار التحكم
function generateBattleRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('atk').setLabel('هجوم').setEmoji('⚔️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('heal').setLabel('جرعة').setEmoji('🧪').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('def').setLabel('دفاع').setEmoji('🛡️').setStyle(ButtonStyle.Secondary)
    );
}

module.exports = { startDungeon };
