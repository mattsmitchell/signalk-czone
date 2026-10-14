# Manual Installation Guide: signalk-czone on Victron Venus OS (Cerbo GX)

This guide provides step-by-step instructions for manually installing the [signalk-czone](https://github.com/mattsmitchell/signalk-czone) custom plugin onto a Victron Cerbo GX running Venus OS Large. 

By default, Venus OS runs on a read-only root file system and lacks Git. This walkthrough covers mounting the root partition as writable, updating packages, and using soft links to safely persist the installation across standard directories.

---

### Step 1: Enable Root Access on Venus OS
1. On your physical GX Touch screen or Remote Console dashboard, navigate to **Settings > General**.
2. Change the **Access Level** to **User and installer** (The default installer password is `zzz`).
3. Scroll down the menu, click **Set root password**, and configure a secure password.
4. Set **SSH on LAN** to **Enabled**.

### Step 2: SSH into the Cerbo GX
Open your computer's terminal (Terminal on macOS/Linux, or Command Prompt/PowerShell on Windows) and establish an SSH connection:
```bash
ssh root@<Your-Cerbo-GX-IP-Address>
```
*When prompted, type the root system password you created in Step 1.*

### Step 3: Mount and Install Git
Venus OS blocks unauthorized changes to its core file system structure by default. You must temporarily remount the root partition to allow the embedded Opkg package manager to pull down Git:
```bash
# Remount the root partition with write access permissions
mount -o remount,rw /

# Update the local package list indexes and download Git
opkg update
opkg install git
```

### Step 4: Clone and Install the Plugin
Navigate to the dedicated persistent plugin directory on your Cerbo GX. Clone the repository path into an entirely lowercase folder target name to prevent casing/indexing conflicts with the Cerbo's operating system environment:
```bash
# Navigate to the correct Venus OS plugin tracking directory
cd /data/conf/signalk-plugins/

# Clone the custom cZone repository directly using the exact lowercase path
git clone https://github.com/mattsmitchell/signalk-czone

# Enter the newly created workspace folder
cd signalk-czone

# Build the plugin binary packages while omitting heavy dev dependencies
npm install --omit=dev
```

### Step 5: Create a Soft Link for Signal K Registration
Create a symbolic soft link configuration mapping your custom lowercase tracking space directly into the active Signal K node modules folder location. This ensures Venus OS indexes it properly on startup:
```bash
ln -s /data/conf/signalk-plugins/signalk-czone /data/conf/signalk/node_modules/signalk-czone
```

### Step 6: Restart the Signal K Daemon
To force the active ecosystem environment to scan, register, and spin up your newly linked module, cycle the background server execution thread using one of these options:

* **Option A (Command Line - Recommended):** Trigger a fast process cycle directly from your current active SSH window terminal utilizing the internal daemontools management utility:
  ```bash
  svc -t /service/signalk-server
  ```
* **Option B (Web UI):** Open up your local web browser interface tracking your Signal K Admin dashboard configuration layout (`http://[Cerbo-GX-IP]:3000`), head directly down into **Server** or **Settings**, and select **Restart**.
* **Option C (Hardware Console):** Go to your physical GX touch display panel screen, scroll into `Settings > Venus OS large features`, toggle **Signal K** off, wait 10 seconds, and flick it back on.

### Step 7: Configure and Upload Your CZone .zcf File
1. Open up your [Signal K Server Admin UI](https://github.com/SignalK/signalk-server) panel and browse directly down to **Server** -> **Plugin Config** -> **CZone**.
2. Click on the custom configuration sub-panel module labeled **Upload and install ZCF**.
3. Select and upload your boat's active CZone `.zcf` configuration file from your computer. 
4. The plugin will automatically extract, validate, and dynamically map your customized circuit name identities directly to the web dashboard interface.

### Enable SD card storage for trends on a Cerbo GX

These steps apply whether the plugin was installed through the Signal K App Store or manually. Trend recording is **off by default**. On a Victron GX it requires a writable SD card or USB stick; the plugin does not use internal flash for trend storage.

Use a FAT32 SD card of 16 GB or more. Insert it into the Cerbo GX and run the following commands as `root` over SSH. The examples use the Cerbo SD card device `/dev/mmcblk0p1`, mounted at `/run/media/mmcblk0p1`. Verify these paths before proceeding; for a USB stick, substitute its device and mount point.

#### 1. Check the card and its permissions

```sh
grep ' /run/media/mmcblk0p1 ' /proc/mounts
```

The filesystem should be `vfat` and mounted `rw`. A typical initial mount has `fmask=0022,dmask=0022`: root can write, but the `signalk` user cannot. The configuration panel then reports **Card found … but Signal K cannot write to it**, and trends are not recorded.

FAT permissions are set at mount time. `chmod` on the card or a `mount -o remount` does not apply the required masks here: a full unmount and mount is needed. If the card is mounted `ro` or uses another filesystem, investigate that before running these commands.

#### 2. Enable writing now

Pause the VRM logger, unmount the card, mount it with writable file and directory masks, then resume the logger:

```sh
svc -d /service/vrmlogger

if umount /run/media/mmcblk0p1; then
  mount -t vfat -o rw,relatime,fmask=0000,dmask=0000 \
    /dev/mmcblk0p1 /run/media/mmcblk0p1
fi

svc -u /service/vrmlogger
```

If unmounting reports **busy**, do not force it. Identify the process using the card before retrying. These masks allow all local users, including `signalk`, to write to the card.

Verify the mount and test writing as the actual Signal K user:

```sh
grep ' /run/media/mmcblk0p1 ' /proc/mounts

setpriv --init-groups --reuid signalk --regid signalk \
  sh -c 'touch /run/media/mmcblk0p1/.signalk-write-test &&
         rm /run/media/mmcblk0p1/.signalk-write-test'
```

The mount should show `fmask=0000,dmask=0000`. No output from the write test means success. These permissions last until the card is remounted or the GX reboots; complete the next step to apply them at boot.

#### 3. Apply the permissions at boot

Create `/data/sdcard-rw.sh`. The `/data` directory persists across firmware updates.

```sh
cat > /data/sdcard-rw.sh <<'EOF'
#!/bin/sh
D=/dev/mmcblk0p1
M=/run/media/mmcblk0p1

# Wait up to 60 seconds for Venus OS to mount the card.
i=0
while ! grep -q "^$D $M vfat " /proc/mounts; do
  i=$((i + 1))
  [ "$i" -ge 30 ] && exit 0
  sleep 2
done

# Leave an already-correct mount alone.
if grep "^$D $M vfat " /proc/mounts |
   grep -q 'fmask=0000,dmask=0000'; then
  exit 0
fi

svc -d /service/vrmlogger
trap 'svc -u /service/vrmlogger' EXIT

# Retry briefly if the card is busy; never force an unmount.
i=0
while ! umount "$M"; do
  i=$((i + 1))
  [ "$i" -ge 10 ] && exit 1
  sleep 1
done

mount -t vfat -o rw,relatime,fmask=0000,dmask=0000 "$D" "$M"
EOF

chmod +x /data/sdcard-rw.sh
```

Register it in `/data/rc.local`. These commands preserve existing startup commands, make a backup, and insert the call before any `exit 0` so it will run. Running them again does not add a duplicate call.

```sh
[ -f /data/rc.local ] || echo '#!/bin/sh' > /data/rc.local
cp -p /data/rc.local /data/rc.local.before-sdcard

if ! grep -q '/data/sdcard-rw.sh' /data/rc.local; then
  awk '
    /^[[:space:]]*exit[[:space:]]+0/ && !added {
      print "/data/sdcard-rw.sh &"
      added=1
    }
    { print }
    END { if (!added) print "/data/sdcard-rw.sh &" }
  ' /data/rc.local > /data/rc.local.new &&
    cat /data/rc.local.new > /data/rc.local &&
    rm /data/rc.local.new
fi

chmod +x /data/rc.local
/data/sdcard-rw.sh
```

The script does nothing if there is no card or the masks are already correct. Otherwise it pauses the VRM logger during the unmount/mount operation and resumes it on exit. After the next reboot, repeat the mount check and the `signalk` write test from step 2.

#### 4. Turn on trend recording

1. Open **Signal K Admin → Server → Plugin Config → CZone**.
2. In **Trends**, tick **Record circuit current trends**.
3. Leave **Trend folder (optional)** blank for automatic SD card selection. On a GX, a custom folder must also be on mounted removable storage.
4. Save the plugin configuration if prompted and check the **Trends** status. It should report **Recording … on the SD card or USB stick at /run/media/mmcblk0p1**. If it still reports a write error, repeat the write test above.

Automatic storage uses `/run/media/mmcblk0p1/signalk-czone/trends`. Current values are sampled every 10 seconds and buffered writes are flushed once a minute. In the webapp, the arrow at the end of a circuit row opens its current trend when recording is enabled.

---

### Real-Time Diagnostics
To verify everything is parsing seamlessly or inspect incoming fast-packet JSON NMEA2000 frame streams directly on your Cerbo GX, stream your system logs utilizing this filter hook:
```bash
journalctl -u signalk --since "2 minutes ago" --no-pager | grep CZONE
```
