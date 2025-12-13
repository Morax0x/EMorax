const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, StringSelectMenuBuilder } = require('discord.js');
const dungeonConfig = require('../json/dungeon-config.json');

// --- دوال مساعدة ---

// حساب قوة اللاعب بناءً على السلاح والمهارات
function calculatePlayerPower(member, sql) {
    const weaponData = sql.prepare("SELECT * FROM user_weapons WHERE userID = ?").get(member.id);
    // القيم الافتراضية
    let stats = { 
        hp: 100, 
        maxHp: 100,
        atk: 10, 
        def: 5, 
        name: member.displayName, 
        id: member.id, 
        isDead: false, 
        defending: false 
    }; 
    
    if (weaponData) {
        // كل لفل سلاح يزيد 5 هجوم و 10 صحة
        stats.atk += (weaponData.weaponLevel * 5); 
        stats.hp += (weaponData.weaponLevel * 10);
        stats.maxHp += (weaponData.weaponLevel * 10);
    }
    return stats;
}

// 🧠 الذكاء الاصطناعي للوحش
function getMonsterAction(monster, players, aiType) {
    const alivePlayers = players.filter(p => !p.isDead);
    if (alivePlayers.length === 0) return { type: 'win', target: null };

    const randomTarget = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    const weakTarget = alivePlayers.sort((a, b) => a.hp - b.hp)[0]; 

    // 1. الذكاء البدائي (عشوائي)
    if (aiType === 'basic') {
        return { type: 'attack', target: randomTarget, multiplier: 1 };
    }

    // 2. الذكاء المتوسط (ذكي)
    if (aiType === 'smart' || aiType === 'defensive') {
        // إذا دمه قليل، يدافع أو يعالج
        if (monster.hp < monster.maxHp * 0.2) {
            return Math.random() > 0.5 ? { type: 'heal', value: monster.maxHp * 0.1 } : { type: 'defend' };
        }
        // الهجوم على الأضعف
        return { type: 'attack', target: weakTarget, multiplier: 1.2 };
    }

    // 3. ذكاء الزعيم (Boss)
    if (aiType.startsWith('boss') || aiType === 'aggressive') {
        // مهارة "الغضب"
        if (monster.hp < monster.maxHp * 0.5 && !monster.enraged) {
            monster.enraged = true;
            return { type: 'enrage', msg: "😡 **الزعيم يغضب!** زاد هجومه بشكل جنوني!" };
        }
        
        // مهارة "هجوم جماعي" (كل 3 جولات)
        if (monster.turnCount % 3 === 0) {
            return { type: 'aoe', target: alivePlayers, multiplier: 0.7 }; 
        }

        // ضربة قاضية للهدف الضعيف
        if (weakTarget.hp < monster.atk * 1.5) {
            return { type: 'attack', target: weakTarget, multiplier: 1.5, msg: `💀 يحاول الزعيم القضاء على ${weakTarget.name}!` };
        }

        return { type: 'attack', target: randomTarget, multiplier: 1.0 };
    }

    return { type: 'attack', target: randomTarget, multiplier: 1 };
}

// --- 1. مرحلة اختيار الثيم ---
async function startDungeon(interaction, sql) {
    const user = interaction.user;
    
    const themeOptions = Object.keys(dungeonConfig.themes).map(key => ({
        label: dungeonConfig.themes[key].name,
        value: key,
        emoji: dungeonConfig.themes[key].emoji
    }));

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('dungeon_theme').setPlaceholder('اختر نوع الدانجون').addOptions(themeOptions)
    );

    const msg = await interaction.reply({ content: "⚔️ **بوابة الدانجون:** اختر العالم الذي تود دخوله:", components: [row], fetchReply: true });

    const filter = i => i.user.id === user.id && i.customId === 'dungeon_theme';
    try {
        const selection = await msg.awaitMessageComponent({ filter, time: 30000 });
        const themeKey = selection.values[0];
        const theme = dungeonConfig.themes[themeKey];
        
        // الانتقال للوبي
        await lobbyPhase(selection, theme, sql);
    } catch (e) {
        await interaction.editReply({ content: "⏰ انتهى الوقت.", components: [] }).catch(()=>{});
    }
}

// --- 2. مرحلة اللوبي (تجميع الفريق) ---
async function lobbyPhase(interaction, theme, sql) {
    const host = interaction.user;
    let party = [host.id]; 
    
    const embed = new EmbedBuilder()
        .setTitle(`${theme.emoji} بوابة الدانجون: ${theme.name}`)
        .setDescription(`القائد: ${host}\n\n👥 **الأعضاء الحاليون (1/5):**\n1. ${host}`)
        .setColor('DarkRed')
        .setFooter({ text: "تكلفة الدخول: 100 مورا لكل شخص" });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('join_dungeon').setLabel('انضمام للفريق').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('start_dungeon').setLabel('بدء المغامرة').setStyle(ButtonStyle.Danger)
    );

    await interaction.update({ content: null, embeds: [embed], components: [row] });
    const msg = await interaction.message;

    const collector = msg.createMessageComponentCollector({ time: 60000 });

    collector.on('collect', async i => {
        if (i.customId === 'join_dungeon') {
            if (party.includes(i.user.id)) return i.reply({ content: "أنت موجود بالفعل!", ephemeral: true });
            if (party.length >= 5) return i.reply({ content: "الفريق ممتلئ!", ephemeral: true });
            
            const userData = sql.prepare("SELECT mora FROM levels WHERE user = ?").get(i.user.id);
            if (!userData || userData.mora < 100) return i.reply({ content: "❌ ليس لديك 100 مورا!", ephemeral: true });
            
            party.push(i.user.id);
            const memberList = party.map((id, index) => `${index + 1}. <@${id}>`).join('\n');
            embed.setDescription(`القائد: ${host}\n\n👥 **الأعضاء الحاليون (${party.length}/5):**\n${memberList}`);
            await i.update({ embeds: [embed] });
        }

        if (i.customId === 'start_dungeon') {
            if (i.user.id !== host.id) return i.reply({ content: "فقط القائد يمكنه البدء.", ephemeral: true });
            collector.stop('start');
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'start') {
            // خصم المورا وبدء اللعبة
            for (const uid of party) {
                sql.prepare("UPDATE levels SET mora = mora - 100 WHERE user = ?").run(uid);
            }
            await runDungeonLevels(interaction, party, theme, sql);
        } else {
            await interaction.editReply({ content: "تم إلغاء الدانجون (انتهى وقت الانتظار).", components: [] }).catch(()=>{});
        }
    });
}

// --- 3. تشغيل الطوابق (القتال) ---
async function runDungeonLevels(interaction, partyIDs, theme, sql) {
    const channel = interaction.channel;
    const guild = interaction.guild;

    // تجهيز بيانات اللاعبين
    let players = [];
    for (const id of partyIDs) {
        const member = await guild.members.fetch(id).catch(()=>null);
        if(member) players.push(calculatePlayerPower(member, sql));
    }

    if(players.length === 0) return channel.send("❌ حدث خطأ في تحميل بيانات اللاعبين.");

    // الحد الأقصى 10 طوابق للجميع
    const maxFloor = 10;

    // حلقة الطوابق
    for (let floorNum = 1; floorNum <= maxFloor; floorNum++) {
        if (players.every(p => p.isDead)) break; // انتهت اللعبة

        const floorConfig = dungeonConfig.floors.find(f => f.floor === floorNum) || dungeonConfig.floors[0];
        
        // تجهيز الوحش
        // زيادة صحة الوحش بناءً على عدد اللاعبين ليكون التحدي عادلاً
        const hpMultiplier = players.length; 
        
        let monsterName = floorConfig.type === 'boss' ? theme.boss : `${theme.name.split(' ')[1]} ${floorConfig.type}`;
        let monster = {
            name: monsterName,
            hp: Math.floor(100 * floorConfig.hp_scale * hpMultiplier),
            maxHp: Math.floor(100 * floorConfig.hp_scale * hpMultiplier),
            atk: Math.floor(10 * floorConfig.atk_scale), // الهجوم ثابت تقريباً لكن يزداد مع الطوابق
            ai: floorConfig.ai,
            turnCount: 0,
            enraged: false
        };

        let battleLog = [`⚔️ **الطابق ${floorNum}:** واجهتم **${monster.name}**! (HP: ${monster.hp})`];
        let battleOngoing = true;
        
        const battleEmbed = new EmbedBuilder().setColor('DarkOrange').setTitle(`Floor ${floorNum} - ${monster.name}`);
        const actionsRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('atk').setLabel('⚔️ هجوم').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('heal').setLabel('💖 علاج').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('def').setLabel('🛡️ دفاع').setStyle(ButtonStyle.Secondary)
        );

        const battleMsg = await channel.send({ embeds: [battleEmbed.setDescription(battleLog.join('\n'))], components: [actionsRow] });

        // حلقة القتال داخل الطابق
        while (battleOngoing) {
            // ننتظر 5 ثواني لجمع ضربات اللاعبين
            const collector = battleMsg.createMessageComponentCollector({ time: 5000 });
            let playerActions = [];

            await new Promise(resolve => {
                collector.on('collect', async i => {
                    const pIndex = players.findIndex(p => p.id === i.user.id);
                    if (pIndex === -1 || players[pIndex].isDead) return i.reply({ content: "أنت ميت أو لست في الفريق!", ephemeral: true });
                    
                    await i.deferUpdate();
                    if (!playerActions.includes(i.user.id)) {
                        playerActions.push(i.user.id);
                        const player = players[pIndex];
                        
                        let dmg = 0;
                        if (i.customId === 'atk') {
                            dmg = Math.floor(player.atk * (0.9 + Math.random() * 0.2)); 
                            monster.hp -= dmg;
                            battleLog.push(`🗡️ **${player.name}** ضرب بـ **${dmg}** ضرر!`);
                        } else if (i.customId === 'heal') {
                            const heal = 25;
                            player.hp = Math.min(player.hp + heal, player.maxHp);
                            battleLog.push(`✨ **${player.name}** عالج نفسه (+${heal}).`);
                        } else if (i.customId === 'def') {
                            player.defending = true;
                            battleLog.push(`🛡️ **${player.name}** يدافع.`);
                        }
                    }
                });
                collector.on('end', resolve);
            });

            // هل مات الوحش؟
            if (monster.hp <= 0) {
                battleLog.push(`🎉 **تم القضاء على ${monster.name}!**`);
                battleOngoing = false;
                
                // الجوائز
                const xp = floorConfig.xp;
                const mora = floorConfig.mora;
                for (const p of players) {
                    // تحديث الداتابيس للأحياء والأموات (الكل يحصل على جائزة الطابق إذا فاز الفريق)
                    // أو الأحياء فقط؟ سنجعلها للأحياء فقط كعقاب
                    if (!p.isDead) {
                        sql.prepare("UPDATE levels SET xp = xp + ?, mora = mora + ? WHERE user = ?").run(xp, mora, p.id);
                        // تحديث أقصى طابق
                        const currentMax = sql.prepare("SELECT max_dungeon_floor FROM levels WHERE user = ?").get(p.id)?.max_dungeon_floor || 0;
                        if (floorNum > currentMax) {
                            sql.prepare("UPDATE levels SET max_dungeon_floor = ? WHERE user = ?").run(floorNum, p.id);
                        }
                    }
                }
                
                if (floorNum === 10) {
                    // جائزة إضافية لختم الدانجون
                    battleLog.push(`🏆 **لقد ختمتم الدانجون!** مكافأة كبرى!`);
                    for (const p of players) {
                        if (!p.isDead) sql.prepare("UPDATE levels SET dungeon_wins = dungeon_wins + 1 WHERE user = ?").run(p.id);
                    }
                }

                battleLog.push(`💰 الجوائز: +${mora} مورا | +${xp} XP`);
                
                battleEmbed.setDescription(battleLog.slice(-15).join('\n')).setColor('Green');
                await battleMsg.edit({ embeds: [battleEmbed], components: [] });
                
                // إنعاش جزئي بسيط للفريق بين الطوابق (اختياري)
                players.forEach(p => { if(!p.isDead) p.hp = Math.min(p.hp + 20, p.maxHp); });

                await new Promise(r => setTimeout(r, 3000));
                continue; 
            }

            // دور الوحش
            monster.turnCount++;
            const aiMove = getMonsterAction(monster, players, floorConfig.ai);
            
            if (aiMove.type === 'attack') {
                let damage = Math.floor(monster.atk * (aiMove.multiplier || 1));
                if (aiMove.target.defending) damage = Math.floor(damage / 2);
                
                aiMove.target.hp -= damage;
                let msg = aiMove.msg || `👹 **${monster.name}** هاجم **${aiMove.target.name}** بـ ${damage} ضرر!`;
                battleLog.push(msg);

                if (aiMove.target.hp <= 0) {
                    aiMove.target.hp = 0;
                    aiMove.target.isDead = true;
                    battleLog.push(`💀 **${aiMove.target.name}** سقط!`);
                }
            } else if (aiMove.type === 'aoe') {
                battleLog.push(`🔥 **${monster.name}** أطلق هجوماً جماعياً!`);
                for (const p of aiMove.target) {
                    let dmg = Math.floor(monster.atk * (aiMove.multiplier || 0.7));
                    if (p.defending) dmg = Math.floor(dmg / 2);
                    p.hp -= dmg;
                    if (p.hp <= 0) {
                        p.hp = 0;
                        p.isDead = true;
                        battleLog.push(`💀 **${p.name}** مات!`);
                    }
                }
            } else if (aiMove.type === 'heal') {
                monster.hp += Math.floor(aiMove.value);
                battleLog.push(`💚 **${monster.name}** عالج نفسه!`);
            } else if (aiMove.type === 'enrage') {
                monster.atk = Math.floor(monster.atk * 1.5);
                battleLog.push(aiMove.msg);
            }

            if (players.every(p => p.isDead)) {
                battleOngoing = false;
                battleLog.push(`☠️ **تم القضاء على الفريق بالكامل...** انتهت الرحلة في الطابق ${floorNum}.`);
                battleEmbed.setDescription(battleLog.slice(-15).join('\n')).setColor('Red');
                await battleMsg.edit({ embeds: [battleEmbed], components: [] });
                return;
            }

            const statusText = players.map(p => `${p.isDead ? '💀' : '❤️'} ${p.name.split(' ')[0]}: ${p.hp}`).join(' | ');
            battleEmbed.setDescription(battleLog.slice(-10).join('\n') + `\n\n${statusText}`);
            await battleMsg.edit({ embeds: [battleEmbed] });
            
            players.forEach(p => p.defending = false);
        }
    }
}

module.exports = { startDungeon };
