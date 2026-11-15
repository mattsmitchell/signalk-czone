#!/bin/sh
# signalk-czone: run by Venus OS at boot, after it has unpacked venus-data.tgz
# from the card into /data. Makes the GX open the trend card for Signal K at
# every start. Safe to run any number of times. The line goes before any
# "exit 0" in rc.local, so that it runs.
chmod +x /data/sdcard-rw.sh
[ -f /data/rc.local ] || echo '#!/bin/sh' > /data/rc.local
if ! grep -q '/data/sdcard-rw.sh' /data/rc.local; then
  awk '/^[[:space:]]*exit[[:space:]]+0/ && !a { print "/data/sdcard-rw.sh &"; a=1 } { print } END { if (!a) print "/data/sdcard-rw.sh &" }' /data/rc.local > /data/rc.local.new &&
    cat /data/rc.local.new > /data/rc.local && rm -f /data/rc.local.new
fi
chmod +x /data/rc.local
exit 0
