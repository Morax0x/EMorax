const { MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, Colors } = require("discord.js");
const core = require('./pvp-core.js'); 
const { calculateMoraBuff } = require('../streak-handler.js'); // ✅ مسار الخروج للمجلد الرئيسي لجلب streak-handler

/**
 * دالة ذكاء اصطناعي بسيطة للوحش (PvE Monster Turn)
 */
async function processMonsterTurn(battleState, sql) {
    const monsterId = "monster";
    // اللاعب هو الخصم
    const playerId = battleState.turn[1]; 
    
    const monster = battleState.players.get(monsterId);
    const player = battleState.players.get(playerId);

    // انتظار بسيط لمحاكاة التفكير
    await new Promise(r => setTimeout(r, 1500)); 

    // 1. تطبيق تأثيرات بداية الدور على الوحش
    const effectsLog = core.applyPersistentEffects(battleState, monsterId);
    battleState.log.push(...effectsLog);

    // إذا مات الوحش بالسم
    if (monster.hp <= 0) {
        await core.endBattle(battleState, playerId, sql, "win");
        return;
    }

    // 2. هجوم الوحش
    let damage = monster.weapon.currentDamage;
    
    // حساب دفاع اللاعب
    let damageTaken = Math.floor(damage);
    if (player.effects.shield > 0) {
        damageTaken = Math.floor(damageTaken * 0.5); // الدرع يقلل 50%
        battleState.log.push(`🛡️ درع اللاعب قلل الضرر!`);
    }

    player.hp -= damageTaken;
    battleState.log.push(`🦑 **${monster.name}** هاجمك وألحق **${damageTaken}** ضرر!`);

    // 3. تقليل عدادات تأثيرات الوحش
    Object.keys(monster.effects).forEach(e => { if (monster.effects[e] > 0) monster.effects[e]--; });

    // 4. هل مات اللاعب؟
    if (player.hp <= 0) {
        player.hp = 0;
        await core.endBattle(battleState, monsterId, sql, "win");
        return;
    }

    // 5. إعادة الدور للاعب
    battleState.turn = [playerId, monsterId];
    
    // تحديث الواجهة
    const { embeds, components } = core.buildBattleEmbed(battleState, false);
    
    // استخدام edit لتحديث الرسالة الموجودة
    if (battleState.message) {
        await battleState.message.edit({ embeds, components }).catch(() => {});
    }
    
    // تحرير القفل
    battleState.processingTurn = false;
}

/**
 * يعالج تفاعلات قبول أو رفض التحدي (Challenge Phase)
 */
async function handlePvpChallenge(i, client, sql) {
    const parts = i.customId.split('_');
    const action = parts[1]; // accept or decline
    const challengerId = parts[2];
    const opponentId = parts[3];
    const bet = parseInt(parts[4]);

    // التأكد من أن الشخص الذي ضغط هو المعني بالتحدي
    if (i.user.id !== opponentId && (action === 'accept' || action === 'decline')) {
        return i.reply({ content: "أنت لست الشخص المطلوب في هذا التحدي.", flags: [MessageFlags.Ephemeral] });
    }

    // 1. حالة رفض التحدي (من الخصم أو إلغاء من المتحدي)
    if ((i.user.id === challengerId || i.user.id === opponentId) && action === 'decline') {
        if (!core.activePvpChallenges.has(i.channel.id)) {
            return i.update({ content: "انتهى وقت هذا التحدي.", embeds: [], components: [] });
        }
        
        core.activePvpChallenges.delete(i.channel.id);

        // إرجاع الكول داون للمتحدي
        const challengerData = client.getLevel.get(challengerId, i.guild.id);
        if (challengerData) {
            challengerData.lastPVP = 0; 
            client.setLevel.run(challengerData);
        }

        const isCancel = i.user.id === challengerId;
        const declineEmbed = new EmbedBuilder()
            .setTitle(isCancel ? '⚔️ تم إلغاء التحدي' : '🛡️ تم رفض التحدي')
            .setDescription(isCancel 
                ? `قام ${core.cleanDisplayName(i.member.user.displayName)} بإلغاء التحدي.` 
                : `لقد قام ${core.cleanDisplayName(i.member.user.displayName)} برفض التحدي.`)
            .setColor(isCancel ? Colors.Grey : Colors.Red);

        return i.update({ embeds: [declineEmbed], components: [] });
    }

    // 2. حالة قبول التحدي
    if (action === 'accept') {
        if (!core.activePvpChallenges.has(i.channel.id)) {
            return i.update({ content: "انتهى وقت هذا التحدي.", embeds: [], components: [] });
        }

        const opponentMember = i.member;
        const challengerMember = await i.guild.members.fetch(challengerId).catch(() => null);

        if (!challengerMember) {
             const challengerData = client.getLevel.get(challengerId, i.guild.id);
             if (challengerData) {
                    challengerData.lastPVP = 0;
                    client.setLevel.run(challengerData);
             }
            return i.update({ content: "لم يتم العثور على المتحدي، ربما غادر السيرفر.", embeds: [], components: [] });
        }

        // التحقق من جاهزية الخصم (الذي قبل)
        const opponentRace = core.getUserRace(opponentMember, sql);
        const opponentWeapon = core.getWeaponData(sql, opponentMember);

        if (!opponentRace || !opponentWeapon || opponentWeapon.currentLevel === 0) {
            return i.reply({
                content: `❌ | لا يمكنك قبول التحدي وأنت لست جاهزاً! (تحتاج إلى عرق + سلاح مستوى 1 على الأقل).`,
                flags: [MessageFlags.Ephemeral]
            });
        }

        // التحقق من جاهزية المتحدي
        const challengerRace = core.getUserRace(challengerMember, sql);
        const challengerWeapon = core.getWeaponData(sql, challengerMember);

        if (!challengerRace || !challengerWeapon || challengerWeapon.currentLevel === 0) {
            const challengerData = client.getLevel.get(challengerId, i.guild.id);
            if (challengerData) {
                challengerData.lastPVP = 0;
                client.setLevel.run(challengerData);
            }
            return i.update({
                content: `❌ | تم إلغاء التحدي! المتحدي (${core.cleanDisplayName(challengerMember.user.displayName)}) لم يعد جاهزاً للقتال.`,
                embeds: [], components: []
            });
        }

        // بدء المعركة فعلياً
        core.activePvpChallenges.delete(i.channel.id);
        await i.deferUpdate(); 

        // تعطيل أزرار رسالة التحدي القديمة
        await i.editReply({ components: [] });

        const acceptEmbed = new EmbedBuilder()
            .setTitle('🔥 تم قبول التحدي!')
            .setDescription(`**${core.cleanDisplayName(opponentMember.user.displayName)}** قبل التحدي!\nجاري تحضير ساحة القتال...`)
            .setColor(Colors.Green);
        
        await i.followUp({ embeds: [acceptEmbed] });

        // استدعاء دالة البدء من الكور
        await core.startPvpBattle(i, client, sql, challengerMember, opponentMember, bet);
    }
}

/**
 * يعالج تفاعلات المعركة (Battle Phase: Attack, Skill, Forfeit)
 */
async function handlePvpTurn(i, client, sql) {
    // 🛠️ التعديل المهم هنا: البحث في القائمتين (PvP و PvE)
    let battleState = core.activePvpBattles.get(i.channel.id);
    let isPvE = false;

    if (!battleState) {
        battleState = core.activePveBattles.get(i.channel.id);
        isPvE = true;
    }
    
    // إذا لم تكن هناك معركة نشطة
    if (!battleState) {
        if (i.customId.startsWith('pvp_')) {
             return i.update({ content: "انتهت هذه المعركة.", components: [] }).catch(() => {});
        }
        return;
    }

    const attackerId = battleState.turn[0];
    const defenderId = battleState.turn[1];

    // التأكد من أن الدور لهذا اللاعب
    if (i.user.id !== attackerId) {
        return i.reply({ content: "ليس دورك! انتظر دور الخصم.", flags: [MessageFlags.Ephemeral] });
    }

    // --- A. معالجة الأزرار التي لا تستهلك الدور (تصفح المهارات) ---
    try {
        if (i.customId === 'pvp_action_skill') {
            const { embeds, components } = core.buildBattleEmbed(battleState, true, battleState.skillPage);
            return await i.update({ embeds, components });
        }
        if (i.customId === 'pvp_skill_back') {
            const { embeds, components } = core.buildBattleEmbed(battleState, false);
            return await i.update({ embeds, components });
        }
        if (i.customId.startsWith('pvp_skill_page_')) {
            const page = parseInt(i.customId.split('_')[3]);
            const { embeds, components } = core.buildBattleEmbed(battleState, true, page);
            return await i.update({ embeds, components });
        }
        
        // التحقق من كولداون المهارة
        if (i.customId.startsWith('pvp_skill_use_')) {
            const skillId = i.customId.replace('pvp_skill_use_', '');
            const attacker = battleState.players.get(attackerId);
            const skill = Object.values(attacker.skills).find(s => s.id === skillId);

            if (!skill || battleState.skillCooldowns[attackerId][skillId] > 0) {
                return i.reply({ content: "هذه المهارة في وضع الانتظار (Cooldown)!", flags: [MessageFlags.Ephemeral] });
            }
        }
    } catch (e) {
        if (e.code === 10062) return; 
        throw e; 
    }

    // --- B. معالجة الأزرار التي تستهلك الدور ---
    if (battleState.processingTurn) {
        return i.reply({ content: "⌛ جاري معالجة الدور...", flags: [MessageFlags.Ephemeral] });
    }
    battleState.processingTurn = true; // قفل

    try {
        await i.deferUpdate();

        const attacker = battleState.players.get(attackerId);
        const defender = battleState.players.get(defenderId);
        const attackerName = attacker.isMonster ? attacker.name : core.cleanDisplayName(attacker.member.user.displayName);
        const defenderName = defender.isMonster ? defender.name : core.cleanDisplayName(defender.member.user.displayName);

        // 1. تأثيرات بداية الدور
        const persistentEffectsLog = core.applyPersistentEffects(battleState, attackerId);
        battleState.log.push(...persistentEffectsLog);

        if (attacker.hp <= 0) {
            attacker.hp = 0;
            const { embeds: preEmbeds, components: preComponents } = core.buildBattleEmbed(battleState);
            await i.editReply({ embeds: preEmbeds, components: preComponents });
            await core.endBattle(battleState, defenderId, sql, "win", calculateMoraBuff);
            return; 
        }

        // 2. تقليل الكولداون
        Object.keys(attacker.effects).forEach(effect => { if (attacker.effects[effect] > 0) attacker.effects[effect]--; });
        Object.keys(battleState.skillCooldowns[attackerId]).forEach(skill => { if (battleState.skillCooldowns[attackerId][skill] > 0) battleState.skillCooldowns[attackerId][skill]--; });

        // 3. الانسحاب
        if (i.customId === 'pvp_action_forfeit') {
            await i.editReply({ content: '🏳️ تم الانسحاب...', embeds: [], components: [] });
            await core.endBattle(battleState, defenderId, sql, "forfeit", calculateMoraBuff);
            return; 
        }

        let actionLog = "";

        // 4. تنفيذ المهارة
        if (i.customId.startsWith('pvp_skill_use_')) {
            const skillId = i.customId.replace('pvp_skill_use_', '');
            const skill = Object.values(attacker.skills).find(s => s.id === skillId);

            battleState.skillCooldowns[attackerId][skillId] = core.SKILL_COOLDOWN_TURNS + 1; 

            switch (skillId) {
                case 'skill_healing':
                    const healAmount = Math.floor(attacker.maxHp * (skill.effectValue / 100));
                    attacker.hp = Math.min(attacker.maxHp, attacker.hp + healAmount);
                    actionLog = `❤️‍🩹 ${attackerName} استخدم الشفاء واستعاد **${healAmount}** HP!`;
                    break;
                case 'skill_shielding':
                    attacker.effects.shield = 2;
                    actionLog = `🛡️ ${attackerName} فعّل الدرع! (حماية ${skill.effectValue}% للدور القادم)`;
                    break;
                case 'skill_buffing':
                    attacker.effects.buff = 2;
                    actionLog = `💪 ${attackerName} فعّل التعزيز! (+${skill.effectValue}% ضرر)`;
                    break;
                case 'skill_rebound':
                     attacker.effects.rebound_active = 2;
                     actionLog = `🔄 ${attackerName} فعّل الارتداد العكسي!`;
                     break;
                case 'skill_weaken':
                    defender.effects.weaken = 2;
                    actionLog = `📉 ${attackerName} أضعف الخصم! (ضرر الخصم القادم -${skill.effectValue}%)`;
                    break;
                case 'skill_dispel':
                    defender.effects.shield = 0; defender.effects.buff = 0; defender.effects.rebound_active = 0; defender.effects.penetrate = 0;
                    actionLog = `💨 ${attackerName} استخدم التبديد! ألغى كل تأثيرات ${defenderName}.`;
                    break;
                case 'skill_cleanse':
                    attacker.effects.weaken = 0; attacker.effects.poison = 0;
                    const cleanseHeal = Math.floor(attacker.maxHp * (skill.effectValue / 100));
                    attacker.hp = Math.min(attacker.maxHp, attacker.hp + cleanseHeal);
                    actionLog = `✨ ${attackerName} تطهر واستعاد **${cleanseHeal}** HP.`;
                    break;
                case 'skill_poison':
                    defender.effects.poison = 4;
                    const basePoisonDmg = skill.effectValue; // قيمة تعتمد على اللفل
                    defender.hp -= basePoisonDmg;
                    actionLog = `☠️ ${attackerName} سمم الخصم! (**${basePoisonDmg}** ضرر فوري + سم مستمر).`;
                    break;
                case 'skill_gamble':
                    const baseDmg = attacker.weapon ? attacker.weapon.currentDamage : 10;
                    let gambleDamage = 0;
                    // تعديل: الحظ يعتمد على المعادلة الجديدة
                    // إذا فاز: سلاح + مهارة * 2 | إذا خسر: نصف سلاح
                    if (Math.random() < 0.5) {
                        gambleDamage = Math.floor(baseDmg + (skill.effectValue * 1.5));
                        actionLog = `🎲 ${attackerName} قامر ونجح! ضربة قوية **${gambleDamage}**!`;
                    } else {
                        gambleDamage = Math.floor(baseDmg * 0.5);
                        actionLog = `🎲 ${attackerName} قامر وفشل... ضربة ضعيفة **${gambleDamage}**.`;
                    }
                    defender.hp -= gambleDamage;
                    break;
                case 'race_dragon_skill':
                    const trueDamage = skill.effectValue; // قيمة ثابتة قوية تعتمد على اللفل
                    defender.hp -= trueDamage;
                    actionLog = `🔥 ${attackerName} أطلق نفس التنين! (**${trueDamage}** ضرر حقيقي).`;
                    break;
                default:
                    // 🔥🔥 التعديل الجذري هنا 🔥🔥
                    // بدلاً من ضرب النسبة، نقوم بجمع (ضرر السلاح + قوة المهارة)
                    // skill.effectValue يزيد مع اللفل، لذا الضرر سيزيد حتماً
                    const weaponDamage = attacker.weapon ? attacker.weapon.currentDamage : 10;
                    const skillBonus = skill.effectValue; 
                    
                    const raceDmg = Math.floor(weaponDamage + skillBonus);
                    defender.hp -= raceDmg;
                    
                    actionLog = `⚔️ ${attackerName} استخدم ${skill.name} وألحق **${raceDmg}** ضرر!`;
                    break;
            }
            battleState.log.push(actionLog);
        }

        // 5. الهجوم العادي
        if (i.customId === 'pvp_action_attack') {
            if (!attacker.weapon || attacker.weapon.currentLevel === 0) {
                 battleState.log.push(`❌ ${attackerName} يحاول الهجوم بلا سلاح!`);
            } else {
                let damage = attacker.weapon.currentDamage;
                if (attacker.effects.buff > 0) {
                    const buffSkill = attacker.skills['skill_buffing'] || attacker.skills['race_human_skill'];
                    if (buffSkill) { damage *= (1 + (buffSkill.effectValue / 100)); }
                }
                if (attacker.effects.weaken > 0) {
                    const weakenSkill = defender.skills['skill_weaken'] || defender.skills['race_ghoul_skill'];
                    let weakenPercent = 0.10;
                    if (weakenSkill && weakenSkill.id === 'skill_weaken') { weakenPercent = weakenSkill.effectValue / 100; }
                    damage *= (1 - weakenPercent);
                }

                let damageTaken = Math.floor(damage);

                if (attacker.effects.penetrate > 0) {
                    battleState.log.push(`👻 ${attackerName} اخترق الدفاعات!`);
                } else if (defender.effects.shield > 0) {
                    const shieldSkill = defender.skills['skill_shielding'] || defender.skills['race_human_skill'] || defender.skills['race_dwarf_skill'];
                    if (shieldSkill) { damageTaken = Math.floor(damageTaken * (1 - (shieldSkill.effectValue / 100))); }
                }

                defender.hp -= damageTaken;
                battleState.log.push(`⚔️ ${attackerName} هاجم وألحق **${damageTaken}** ضرر!`);

                if (defender.effects.rebound_active > 0 && defender.skills['skill_rebound']) {
                    const reboundSkill = defender.skills['skill_rebound'];
                    const reboundPercent = reboundSkill.effectValue / 100;
                    const reboundDamage = Math.floor(damageTaken * reboundPercent);
                    if (reboundDamage > 0) {
                        attacker.hp -= reboundDamage;
                        battleState.log.push(`🔄 ${defenderName} رد **${reboundDamage}** ضرر!`);
                    }
                }
            }
        }

        // 6. التحقق من النهاية
        if (defender.hp <= 0) {
            defender.hp = 0;
            const { embeds, components } = core.buildBattleEmbed(battleState);
            await i.editReply({ embeds, components });
            await core.endBattle(battleState, attackerId, sql, "win", calculateMoraBuff);
            return;
        }
        if (attacker.hp <= 0) {
            attacker.hp = 0;
            const { embeds, components } = core.buildBattleEmbed(battleState);
            await i.editReply({ embeds, components });
            await core.endBattle(battleState, defenderId, sql, "win", calculateMoraBuff);
            return;
        }

        // 7. تبديل الدور
        battleState.turn = [defenderId, attackerId];
        const { embeds, components } = core.buildBattleEmbed(battleState, false);
        await i.editReply({ embeds, components });

        // 🤖 إذا كان الدور التالي للوحش (PvE)، شغله تلقائياً
        if (isPvE && battleState.turn[0] === "monster") {
            processMonsterTurn(battleState, sql); // تشغيل بدون await لتحرير القفل لاحقاً
        } else {
            battleState.processingTurn = false;
        }

    } catch (err) {
        console.error("[PvP Handler Error]", err);
        if (!i.replied) await i.followUp({ content: "حدث خطأ.", flags: [MessageFlags.Ephemeral] }).catch(() => {});
    } finally {
        // في حال لم يكن دور الوحش، نحرر القفل فوراً
        // إذا كان دور الوحش، القفل سيتحرر داخل processMonsterTurn
        if (battleState && (!isPvE || battleState.turn[0] !== "monster")) {
            battleState.processingTurn = false;
        }
    }
}

/**
 * الموجه الرئيسي لتفاعلات الـ PvP
 */
async function handlePvpInteraction(i, client, sql) {
    try {
        if (i.customId.startsWith('pvp_accept_') || i.customId.startsWith('pvp_decline_')) {
            await handlePvpChallenge(i, client, sql);
        } else {
            await handlePvpTurn(i, client, sql);
        }
    } catch (error) {
        if (error.code === 10062) return; 
        console.error("[PvP Handler] Critical Error:", error);
    }
}

module.exports = {
    handlePvpInteraction,
    activePvpChallenges: core.activePvpChallenges,
    activePvpBattles: core.activePvpBattles,
};
