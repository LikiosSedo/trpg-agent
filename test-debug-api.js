#!/usr/bin/env node
/**
 * 调试 API 测试脚本
 *
 * 用法：
 *   node test-debug-api.js                    # 运行所有诊断
 *   node test-debug-api.js diagnostics        # 完整诊断报告
 *   node test-debug-api.js npc-panel          # NPC 面板数据
 *   node test-debug-api.js session            # 会话状态
 */

const BASE_URL = process.env.TRPG_URL || 'http://localhost:3000'

async function fetchAPI(endpoint) {
  const url = `${BASE_URL}${endpoint}`
  console.log(`\n📡 GET ${url}`)

  try {
    const response = await fetch(url)
    const data = await response.json()

    if (!response.ok) {
      console.error(`❌ HTTP ${response.status}:`, data.error || data)
      return null
    }

    return data
  } catch (err) {
    console.error(`❌ 请求失败:`, err.message)
    return null
  }
}

function printDiagnostics(report) {
  console.log('\n' + '='.repeat(60))
  console.log('🔍 系统诊断报告')
  console.log('='.repeat(60))
  console.log(`时间: ${new Date(report.timestamp).toLocaleString('zh-CN')}`)
  console.log(`\n总计: ${report.summary.total} 项检查`)
  console.log(`✅ 通过: ${report.summary.passed}`)
  console.log(`⚠️  警告: ${report.summary.warnings}`)
  console.log(`❌ 失败: ${report.summary.failed}`)

  const categories = {}
  for (const check of report.checks) {
    if (!categories[check.category]) categories[check.category] = []
    categories[check.category].push(check)
  }

  for (const [category, checks] of Object.entries(categories)) {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`📦 ${category}`)
    console.log('─'.repeat(60))

    for (const check of checks) {
      const icon = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌'
      console.log(`\n${icon} ${check.name}`)
      console.log(`   ${check.message}`)
      if (check.details) {
        console.log(`   详情: ${JSON.stringify(check.details, null, 2).split('\n').join('\n   ')}`)
      }
    }
  }
}

function printNPCPanel(data) {
  console.log('\n' + '='.repeat(60))
  console.log('👥 NPC 面板数据')
  console.log('='.repeat(60))
  console.log(`\n玩家位置: ${data.playerLocation}/${data.playerSubLocation}`)

  const here = []
  const away = []

  for (const npc of data.npcs) {
    const loc = data.npcLocations[npc.key]
    if (loc && loc.location === data.playerLocation && loc.subLocation === data.playerSubLocation) {
      here.push(npc)
    } else {
      away.push(npc)
    }
  }

  if (here.length > 0) {
    console.log('\n✨ 当前在场:')
    for (const npc of here) {
      console.log(`  - ${npc.name} (${npc.key}) | 信任: ${npc.trust} | 状态: ${npc.condition || 'normal'}`)
    }
  }

  if (away.length > 0) {
    console.log('\n📍 不在身边:')
    for (const npc of away) {
      const loc = data.npcLocations[npc.key]
      const locStr = loc ? `${loc.location}/${loc.subLocation}` : '未知'
      console.log(`  - ${npc.name} (${npc.key}) | 位置: ${locStr} | 信任: ${npc.trust}`)
    }
  }
}

function printSession(data) {
  console.log('\n' + '='.repeat(60))
  console.log('🎮 会话状态')
  console.log('='.repeat(60))

  console.log('\n👤 玩家:')
  console.log(`  名字: ${data.player.name}`)
  console.log(`  职业: ${data.player.class}`)
  console.log(`  生命: ${data.player.hp}/${data.player.maxHp}`)
  console.log(`  金币: ${data.player.gold}`)

  console.log('\n🗺️  世界:')
  console.log(`  位置: ${data.world.location}/${data.world.subLocation}`)
  console.log(`  时间: ${data.world.timeOfDay}`)

  if (data.chapter) {
    console.log('\n📖 章节:')
    console.log(`  当前: ${data.chapter.current}`)
    console.log(`  完成节点: ${data.chapter.completedBeats.length} 个`)
  }

  if (data.combat.active) {
    console.log('\n⚔️  战斗:')
    console.log(`  回合: ${data.combat.round}`)
    console.log(`  怪物: ${data.combat.monsters} 个`)
  }

  console.log(`\n👥 NPC (${data.npcs.length} 个):`)
  for (const npc of data.npcs) {
    console.log(`  - ${npc.name} | 信任: ${npc.trust} | ${npc.location}/${npc.subLocation}`)
  }

  console.log(`\n🔄 回合数: ${data.turnCount}`)
}

async function main() {
  const command = process.argv[2] || 'all'

  switch (command) {
    case 'diagnostics':
      const report = await fetchAPI('/api/debug/diagnostics')
      if (report) printDiagnostics(report)
      break

    case 'npc-panel':
      const panelData = await fetchAPI('/api/debug/npc-panel')
      if (panelData) printNPCPanel(panelData)
      break

    case 'session':
      const sessionData = await fetchAPI('/api/debug/session')
      if (sessionData) printSession(sessionData)
      break

    case 'all':
    default:
      console.log('🚀 运行所有诊断...\n')

      const d = await fetchAPI('/api/debug/diagnostics')
      if (d) printDiagnostics(d)

      const p = await fetchAPI('/api/debug/npc-panel')
      if (p) printNPCPanel(p)

      const s = await fetchAPI('/api/debug/session')
      if (s) printSession(s)

      console.log('\n' + '='.repeat(60))
      console.log('✅ 所有诊断完成')
      console.log('='.repeat(60))
      break
  }
}

main().catch(err => {
  console.error('❌ 脚本执行失败:', err)
  process.exit(1)
})
