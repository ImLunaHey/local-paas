{ lib, pkgs, modulesPath, agent, index, ... }:
let
  name = "local-paas-worker-${toString index}";
  subnet = "172.31.${toString index}.0/24";
in {
  imports = [ (modulesPath + "/virtualisation/qemu-vm.nix") ];
  networking.hostName = name;
  system.stateVersion = "26.05";
  nix.enable = false;
  systemd.services.register-nix-paths.enable = false;
  virtualisation = {
    memorySize = 2048; cores = 1; diskSize = 16384;
    diskImage = "./worker.qcow2"; graphics = false;
    useNixStoreImage = true; mountHostNixStore = false; useHostCerts = false;
    sharedDirectories = lib.mkForce {};
    forwardPorts = builtins.genList (slot: {
      from = "host"; host.address = "127.0.0.1";
      host.port = 21000 + (index - 1) * 100 + slot; guest.port = 20000 + slot;
    }) 4;
    qemu.options = [
      "-drive file=/var/lib/${name}/credentials.iso,format=raw,media=cdrom,readonly=on"
      "-sandbox on,obsolete=deny,elevateprivileges=deny,spawn=deny,resourcecontrol=deny"
    ];
    containerd.enable = true;
  };
  networking.nameservers = [ "1.1.1.1" "8.8.8.8" ];
  networking.extraHosts = "10.0.2.2 controller.local-paas";
  networking.dhcpcd.extraConfig = "nohook resolv.conf";
  networking.enableIPv6 = false;
  networking.firewall.allowedTCPPortRanges = [ { from = 20000; to = 20003; } ];
  services.openssh.enable = false;
  services.getty.autologinUser = lib.mkForce null;
  users.users.root.hashedPassword = "!";
  users.groups.workload = {};
  users.users.workload = {
    isSystemUser = true; group = "workload";
    subUidRanges = [ { startUid = 100000; count = 65536; } ];
    subGidRanges = [ { startGid = 100000; count = 65536; } ];
  };
  security.apparmor.enable = true;
  security.apparmor.policies.local-paas.profile = ''
    #include <tunables/global>
    profile local-paas flags=(attach_disconnected,mediate_deleted) {
      #include <abstractions/base>
      file,
      network inet stream,
      network inet dgram,
      network inet6 stream,
      network inet6 dgram,
      signal (send,receive),
      deny /proc/sys/** wklx,
      deny /sys/** wklx,
      deny /proc/kcore rw,
      deny /proc/*/mem rw,
    }
  '';
  environment.systemPackages = with pkgs; [ nerdctl curl ];
  environment.etc."containerd/certs.d/127.0.0.1:15000/hosts.toml".text = ''
    server = "http://10.0.2.2:15000"
    [host."http://10.0.2.2:15000"]
      capabilities = ["pull", "resolve"]
  '';
  environment.etc."cni/net.d/10-workloads.conflist".text = builtins.toJSON {
    cniVersion = "1.0.0"; name = "workloads";
    plugins = [
      { type = "bridge"; bridge = "lpbr0"; isGateway = true; ipMasq = true;
        ipam = { type = "host-local"; ranges = [[ { inherit subnet; } ]]; routes = [ { dst = "0.0.0.0/0"; } ]; }; }
      { type = "portmap"; capabilities.portMappings = true; }
      { type = "firewall"; backend = "iptables"; }
    ];
  };
  environment.etc."nerdctl/nerdctl.toml".text = ''
    cni_path = "${pkgs.cni-plugins}/bin"
    cni_netconfpath = "/etc/cni/net.d"
  '';
  boot.kernel.sysctl = {
    "net.ipv4.ip_forward" = 1;
    "kernel.unprivileged_bpf_disabled" = 1;
  };
  systemd.services.workload-network-policy = {
    before = [ "node-agent.service" ]; requiredBy = [ "node-agent.service" ];
    serviceConfig = { Type = "oneshot"; RemainAfterExit = true; };
    script = ''
      ${pkgs.nftables}/bin/nft -f - <<'RULES'
      table inet local_paas_workloads {
        chain input { type filter hook input priority -20; policy accept; ct state established,related accept; iifname "lpbr0" drop; }
        chain forward {
          type filter hook forward priority -20; policy accept;
          ct state established,related accept
          iifname "lpbr0" meta nfproto ipv6 drop
          iifname "lpbr0" ip daddr { 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, 224.0.0.0/4, 240.0.0.0/4 } reject
          iifname "lpbr0" tcp dport { 80, 443 } accept
          iifname "lpbr0" ip daddr { 1.1.1.1, 8.8.8.8 } udp dport 53 accept
          iifname "lpbr0" drop
        }
      }
      RULES
    '';
  };
  systemd.services.node-credentials = {
    before = [ "node-agent.service" ]; requiredBy = [ "node-agent.service" ];
    serviceConfig = { Type = "oneshot"; RemainAfterExit = true; UMask = "0077"; };
    path = [ pkgs.util-linux pkgs.coreutils ];
    script = ''
      mkdir -p /run/node-media /run/node-credentials
      mount -o ro /dev/disk/by-label/NODE_CREDS /run/node-media
      cp /run/node-media/{config.json,client.crt,client.key,ca.crt} /run/node-credentials/
      chmod 600 /run/node-credentials/*
      umount /run/node-media
    '';
  };
  systemd.services.node-agent = {
    environment.SECRET_EXECUTOR = "${agent}/bin/secret-exec";
    wantedBy = [ "multi-user.target" ];
    after = [ "network-online.target" "containerd.service" "node-credentials.service" "workload-network-policy.service" "apparmor.service" ];
    requires = [ "containerd.service" ]; wants = [ "network-online.target" ];
    path = with pkgs; [ nerdctl runc iproute2 iptables coreutils ];
    serviceConfig = {
      ExecStart = "${agent}/bin/node-agent";
      Restart = "always"; RestartSec = 3;
      StateDirectory = "local-paas-agent"; UMask = "0077";
      Delegate = true; LimitCORE = 0; MemoryMax = "256M"; TasksMax = 256;
      StandardOutput = "journal+console"; StandardError = "journal+console";
      SyslogLevel = "warning";
    };
  };
  services.journald.extraConfig = "SystemMaxUse=64M\nRuntimeMaxUse=32M\nForwardToConsole=yes\nMaxLevelConsole=warning";
}
