function getDashboardHtml(config = {}, browserStatus = false) {
  return `
  <!DOCTYPE html>
  <html lang="tr">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Fusion Dizipal | Yönetim Paneli</title>
      <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #1a1a1a; color: #f5f5f5; margin: 0; padding: 20px; }
          .container { max-width: 800px; margin: 0 auto; background-color: #2a2a2a; padding: 30px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
          h1 { color: #03a9f4; text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px;}
          .status-card { display: flex; justify-content: space-between; background-color: #333; padding: 20px; border-radius: 8px; margin-top: 20px; }
          .status-item { text-align: center; }
          .status-value { font-size: 24px; font-weight: bold; margin-top: 10px; }
          .status-indicator { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 5px; }
          .active { background-color: #4CAF50; box-shadow: 0 0 8px #4CAF50; }
          .inactive { background-color: #F44336; box-shadow: 0 0 8px #F44336; }
          
          /* Log Terminali */
          .terminal { background-color: #0f0f0f; color: #00ff00; font-family: monospace; padding: 15px; border-radius: 5px; height: 350px; overflow-y: auto; margin-top: 20px; border: 1px solid #333; }
          .log-entry { margin-bottom: 5px; border-bottom: 1px dashed #222; padding-bottom: 4px; }
          .log-time { color: #888; margin-right: 10px; }
          .log-type-INFO { color: #2196F3; font-weight: bold; }
          .log-type-ERROR { color: #F44336; font-weight: bold; }
          .log-type-WARN { color: #FF9800; font-weight: bold; }
          .log-type-SYSTEM { color: #9C27B0; font-weight: bold; }
          .log-type-DEBUG { color: #9E9E9E; }
          
          .footer { text-align: center; margin-top: 30px; color: #888; font-size: 14px; }
      </style>
  </head>
  <body>
      <div class="container">
          <h1>Fusion Dizipal - Premium Dashboard</h1>
          
          <div class="status-card">
              <div class="status-item">
                  <div>Eklenti Sürümü</div>
                  <div class="status-value" id="versionVal">Yükleniyor...</div>
              </div>
              <div class="status-item">
                  <div>Chromium Tarayıcı</div>
                  <div class="status-value">
                      <span id="browserIndicator" class="status-indicator inactive"></span>
                      <span id="browserText">Beklemede</span>
                  </div>
              </div>
              <div class="status-item">
                  <div>Dizipal Kaynak</div>
                  <div class="status-value" style="color: #4CAF50;">Aktif</div>
              </div>
          </div>
          
          <h3 style="margin-top: 30px; color: #aaa;">Canlı Sistem Logları</h3>
          <div class="terminal" id="logTerminal">
             Sistem başlatılıyor...
          </div>
          
          <div class="footer">
              Geliştirilmiş Stremio Addon | <a href="https://github.com/dzirambola/hassio-addons" style="color:#03a9f4; text-decoration:none;">Github</a>
          </div>
      </div>
      
      <script>
          async function fetchStatus() {
              try {
                  const res = await fetch('/api/status');
                  const data = await res.json();
                  
                  // Versiyon güncelle
                  document.getElementById('versionVal').innerText = "v" + data.version;
                  
                  // Tarayıcı durumu güncelle
                  const ind = document.getElementById('browserIndicator');
                  const txt = document.getElementById('browserText');
                  if (data.browserActive) {
                      ind.className = 'status-indicator active';
                      txt.innerText = 'Çalışıyor';
                  } else {
                      ind.className = 'status-indicator inactive';
                      txt.innerText = 'Boşta (Uyku)';
                  }
                  
                  // Logları güncelle
                  const term = document.getElementById('logTerminal');
                  if (data.logs && data.logs.length > 0) {
                      term.innerHTML = data.logs.map(l => 
                          '<div class="log-entry">' +
                          '<span class="log-time">[' + l.time + ']</span>' +
                          '<span class="log-type-' + l.type + '">[' + l.type + ']</span> ' +
                          '<span>' + l.msg + '</span>' +
                          '</div>'
                      ).join('');
                  } else {
                      term.innerHTML = '<div style="color:#888;">Henüz log kaydı yok...</div>';
                  }
                  
              } catch(e) {
                  console.error("Dashboard fetch error:", e);
                  document.getElementById('browserText').innerText = "Bağlantı Koptu";
                  document.getElementById('browserIndicator').className = 'status-indicator inactive';
              }
          }
          
          // İlk yükleme
          fetchStatus();
          // 1.5 saniyede bir güncelle
          setInterval(fetchStatus, 1500);
      </script>
  </body>
  </html>
  `;
}

module.exports = { getDashboardHtml };
