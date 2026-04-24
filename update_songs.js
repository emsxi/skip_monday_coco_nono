// Smart song updater: fetch Zhou Shen's top songs from QQ Music, then diff with existing data
const https = require('https');
const fs = require('fs');

const DATA_PATH = '/Users/elsietan/WorkBuddy/跳过周一/monday-skipper/data.json';

// Fetch Zhou Shen's song list from QQ Music singer page API
// Zhou Shen's singer_mid on QQ Music: 0025NhlN2yWrP4
function fetchSingerSongs(singerMid, page, pageSize) {
  return new Promise((resolve) => {
    const reqData = JSON.stringify({
      singerSongList: {
        module: "musichall.song_list_server",
        method: "GetSingerSongList",
        param: { singer_mid: singerMid, begin: page * pageSize, num: pageSize, order: 1 }
      }
    });
    const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg?data=' + encodeURIComponent(reqData);
    
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://y.qq.com/' },
      timeout: 15000
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          const list = j.singerSongList && j.singerSongList.data && j.singerSongList.data.songList;
          if (list && list.length > 0) {
            resolve(list.map(item => ({
              mid: item.songInfo.mid,
              name: item.songInfo.name,
              singer: item.songInfo.singer.map(s => s.name).join(',')
            })));
          } else {
            resolve([]);
          }
        } catch(e) { resolve([]); }
      });
    }).on('error', () => resolve([])).on('timeout', function() { this.destroy(); resolve([]); });
  });
}

// Verify a songmid is valid
function verifySongmid(mid) {
  return new Promise((resolve) => {
    const reqData = JSON.stringify({
      songinfo: { module: "music.pf_song_detail_svr", method: "get_song_detail_yqq", param: { song_mid: mid } }
    });
    const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg?data=' + encodeURIComponent(reqData);
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://y.qq.com/' },
      timeout: 10000
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          const info = j.songinfo && j.songinfo.data && j.songinfo.data.track_info;
          resolve(info && info.name ? { ok: true, name: info.name } : { ok: false });
        } catch(e) { resolve({ ok: false }); }
      });
    }).on('error', () => resolve({ ok: false }));
  });
}

async function main() {
  console.log('=== QQ Music Smart Song Updater ===\n');
  
  // Step 1: Fetch Zhou Shen's songs from QQ Music (top 100)
  console.log('Step 1: Fetching Zhou Shen\'s songs from QQ Music search...');
  const SINGER_MID = '003fA5G40k6hKc'; // Zhou Shen (verified)
  let allQQSongs = [];
  
  // Use search API with pagination (singer song list API requires auth)
  for (let page = 1; page <= 5; page++) { // 5 pages x 20 = 100 songs
    const songs = await new Promise((resolve) => {
      const reqData = JSON.stringify({
        search: {
          module: "music.search.SearchCgiService",
          method: "DoSearchForQQMusicDesktop",
          param: { search_type: 0, query: "周深", page_num: page, num_per_page: 20 }
        }
      });
      const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg?data=' + encodeURIComponent(reqData);
      https.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://y.qq.com/' },
        timeout: 15000
      }, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            const list = j.search && j.search.data && j.search.data.body && j.search.data.body.song && j.search.data.body.song.list;
            if (list) {
              resolve(list.filter(s => s.singer && s.singer.some(si => si.name.includes('周深'))).map(s => ({
                mid: s.mid, name: s.name, singer: s.singer.map(si => si.name).join(',')
              })));
            } else resolve([]);
          } catch(e) { resolve([]); }
        });
      }).on('error', () => resolve([]));
    });
    
    if (songs.length === 0) break;
    allQQSongs = allQQSongs.concat(songs);
    console.log('  Page ' + page + ': got ' + songs.length + ' songs (total: ' + allQQSongs.length + ')');
    await new Promise(r => setTimeout(r, 5000)); // 5s delay between pages
  }
  
  // Deduplicate by name
  const seen = new Set();
  allQQSongs = allQQSongs.filter(s => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
  
  console.log('  Total unique songs: ' + allQQSongs.length + '\n');
  
  // Build lookup: song name -> songmid
  const qqLookup = {};
  allQQSongs.forEach(s => {
    qqLookup[s.name] = s.mid;
  });
  
  // Step 2: Load existing data
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const existingNames = new Set(data.songs.map(s => s.name));
  
  console.log('Step 2: Current data has ' + data.songs.length + ' songs\n');
  
  // Step 3: Update existing songs - verify/fix links
  console.log('Step 3: Verifying existing songs...');
  let fixedCount = 0;
  let verifiedCount = 0;
  let invalidCount = 0;
  
  for (const s of data.songs) {
    const qqMid = qqLookup[s.name];
    
    if (qqMid) {
      // Found in QQ Music catalog
      const newUrl = 'https://y.qq.com/n/ryqq/songDetail/' + qqMid;
      if (s.qqMusic !== newUrl) {
        s.qqMusic = newUrl;
        console.log('  UPDATED: ' + s.name + ' -> ' + qqMid);
        fixedCount++;
      } else {
        verifiedCount++;
      }
    } else if (s.qqMusic) {
      // Not in catalog but has a link - verify it
      const mid = s.qqMusic.split('songDetail/')[1];
      if (mid) {
        const check = await verifySongmid(mid);
        if (check.ok) {
          verifiedCount++;
        } else {
          console.log('  INVALID: ' + s.name + ' (mid ' + mid + ' no longer valid)');
          s.qqMusic = '';
          invalidCount++;
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }
  
  console.log('  Verified: ' + verifiedCount + ', Updated: ' + fixedCount + ', Invalid: ' + invalidCount + '\n');
  
  // Step 4: Find new songs not in our list
  console.log('Step 4: Looking for new songs to add...');
  const moods = ['好听', '治愈', '温暖', '感动', '欢乐', '空灵', '深情', '大气', '甜蜜', '励志', '安静', '古风'];
  let addedCount = 0;
  
  for (const qqSong of allQQSongs) {
    if (!existingNames.has(qqSong.name) && qqSong.singer.includes('周深')) {
      data.songs.push({
        name: qqSong.name,
        mood: moods[Math.floor(Math.random() * moods.length)],
        qqMusic: 'https://y.qq.com/n/ryqq/songDetail/' + qqSong.mid
      });
      existingNames.add(qqSong.name);
      addedCount++;
      if (addedCount <= 10) {
        console.log('  NEW: ' + qqSong.name + ' (' + qqSong.mid + ')');
      }
    }
  }
  if (addedCount > 10) console.log('  ... and ' + (addedCount - 10) + ' more');
  console.log('  Added: ' + addedCount + ' new songs\n');
  
  // Save
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
  
  // Final summary
  const withLink = data.songs.filter(s => s.qqMusic);
  console.log('=== FINAL SUMMARY ===');
  console.log('Total songs: ' + data.songs.length);
  console.log('With QQ Music link: ' + withLink.length);
  console.log('Without link: ' + (data.songs.length - withLink.length));
}

main();
