// Batch search QQ Music for real songmids with longer delays to avoid rate limiting
const https = require('https');
const fs = require('fs');

const data = JSON.parse(fs.readFileSync('/Users/elsietan/WorkBuddy/跳过周一/monday-skipper/data.json','utf8'));

function qqSearch(keyword) {
  return new Promise((resolve) => {
    const reqData = JSON.stringify({
      search: {
        module: "music.search.SearchCgiService",
        method: "DoSearchForQQMusicDesktop",
        param: { search_type: 0, query: keyword, page_num: 1, num_per_page: 5 }
      }
    });
    const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg?data=' + encodeURIComponent(reqData);
    
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://y.qq.com/',
        'Accept': 'application/json'
      },
      timeout: 15000
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          const songs = j.search && j.search.data && j.search.data.body && j.search.data.body.song && j.search.data.body.song.list;
          if (songs && songs.length > 0) {
            // Find Zhou Shen's version
            const match = songs.find(s => s.singer && s.singer.some(si => si.name.includes('周深')));
            if (match) {
              resolve({ mid: match.mid, name: match.name, singer: match.singer.map(s=>s.name).join(',') });
            } else {
              resolve(null);
            }
          } else {
            resolve(null);
          }
        } catch(e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null)).on('timeout', function() { this.destroy(); resolve(null); });
  });
}

function verifySongmid(mid) {
  return new Promise((resolve) => {
    const reqData = JSON.stringify({
      songinfo: {
        module: "music.pf_song_detail_svr",
        method: "get_song_detail_yqq",
        param: { song_mid: mid }
      }
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
          if (info && info.name) {
            resolve({ ok: true, name: info.name, singer: info.singer.map(s=>s.name).join(',') });
          } else {
            resolve({ ok: false });
          }
        } catch(e) { resolve({ ok: false }); }
      });
    }).on('error', () => resolve({ ok: false })).on('timeout', function() { this.destroy(); resolve({ ok: false }); });
  });
}

async function main() {
  console.log('=== QQ Music Song Link Updater ===\n');
  
  let updated = 0;
  let verified = 0;
  let failed = [];
  
  for (let i = 0; i < data.songs.length; i++) {
    const s = data.songs[i];
    const hasLink = s.qqMusic && s.qqMusic.includes('songDetail');
    
    if (hasLink) {
      // Already has link - verify it
      const mid = s.qqMusic.split('songDetail/')[1];
      const check = await verifySongmid(mid);
      if (check.ok) {
        console.log((i+1).toString().padStart(2) + '. ' + s.name.padEnd(15) + ' VERIFIED: ' + check.singer + ' - ' + check.name);
        verified++;
      } else {
        console.log((i+1).toString().padStart(2) + '. ' + s.name.padEnd(15) + ' BAD LINK - searching...');
        s.qqMusic = ''; // Clear bad link, will search below
      }
      await new Promise(r => setTimeout(r, 1500));
    }
    
    if (!s.qqMusic) {
      // Need to search
      console.log((i+1).toString().padStart(2) + '. ' + s.name.padEnd(15) + ' searching...');
      
      // Try different search queries
      const queries = [
        '周深 ' + s.name,
        s.name + ' 周深',
        s.name
      ];
      
      let found = false;
      for (const q of queries) {
        const result = await qqSearch(q);
        if (result && result.mid) {
          // Verify it
          const check = await verifySongmid(result.mid);
          if (check.ok) {
            s.qqMusic = 'https://y.qq.com/n/ryqq/songDetail/' + result.mid;
            console.log('    -> FOUND & VERIFIED: ' + result.mid + ' (' + check.singer + ' - ' + check.name + ')');
            updated++;
            found = true;
            break;
          }
        }
        await new Promise(r => setTimeout(r, 2000)); // Longer delay between retries
      }
      
      if (!found) {
        console.log('    -> NOT FOUND');
        failed.push(s.name);
      }
      
      await new Promise(r => setTimeout(r, 2000)); // Delay between songs
    }
  }
  
  // Save
  fs.writeFileSync('/Users/elsietan/WorkBuddy/跳过周一/monday-skipper/data.json', JSON.stringify(data, null, 2), 'utf8');
  
  // Summary
  const withLink = data.songs.filter(s => s.qqMusic);
  console.log('\n=== SUMMARY ===');
  console.log('Total songs: ' + data.songs.length);
  console.log('Already verified: ' + verified);
  console.log('Newly found: ' + updated);
  console.log('With link: ' + withLink.length + '/' + data.songs.length);
  if (failed.length > 0) {
    console.log('Still missing: ' + failed.join(', '));
  }
}

main();
