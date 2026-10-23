{ config, lib, pkgs, modulesPath, ... }:
{
  imports = [ (modulesPath + "/virtualisation/qemu-vm.nix") ];
  networking.hostName = "local-paas-builder";
  system.stateVersion = "26.05";
  nix.enable = false;
  systemd.services.register-nix-paths.enable = false;
  virtualisation = {
    memorySize = 3072;
    cores = 2;
    diskSize = 16384;
    diskImage = "./builder.qcow2";
    graphics = false;
    useNixStoreImage = true;
    mountHostNixStore = false;
    useHostCerts = false;
    sharedDirectories = lib.mkForce {};
    forwardPorts = [
      { from = "host"; host.address = "127.0.0.1"; host.port = 12340; guest.port = 1234; }
      { from = "host"; host.address = "127.0.0.1"; host.port = 15000; guest.port = 15000; }
    ];
    qemu.options = [
      "-drive file=/var/lib/local-paas-builder/credentials.iso,format=raw,media=cdrom,readonly=on"
      "-sandbox on,obsolete=deny,elevateprivileges=deny,spawn=deny,resourcecontrol=deny"
    ];
  };
  # DNS goes directly to public resolvers, never Lake's LAN resolver.
  networking.nameservers = [ "1.1.1.1" "8.8.8.8" ];
  networking.dhcpcd.extraConfig = "nohook resolv.conf";
  networking.firewall.allowedTCPPorts = [ 1234 15000 ];
  services.openssh.enable = false;
  services.getty.autologinUser = lib.mkForce null;
  users.users.root.hashedPassword = "!";
  environment.systemPackages = with pkgs; [ buildkit curl ];
  boot.kernel.sysctl."kernel.unprivileged_bpf_disabled" = 1;
  systemd.services.builder-credentials = {
    before = [ "buildkit.service" ];
    requiredBy = [ "buildkit.service" ];
    serviceConfig = { Type = "oneshot"; RemainAfterExit = true; UMask = "0077"; };
    path = [ pkgs.util-linux pkgs.coreutils ];
    script = ''
      mkdir -p /run/builder-media /run/builder-tls
      mount -o ro /dev/disk/by-label/BUILDER_TLS /run/builder-media
      install -m 0600 /run/builder-media/server.key /run/builder-tls/key.pem
      install -m 0644 /run/builder-media/server.crt /run/builder-tls/cert.pem
      install -m 0644 /run/builder-media/ca.crt /run/builder-tls/ca.pem
      umount /run/builder-media
    '';
  };
  environment.etc."buildkit/buildkitd.toml".text = ''
    root = "/var/lib/buildkit"
    insecure-entitlements = []
    [grpc]
      address = ["tcp://0.0.0.0:1234"]
      [grpc.tls]
        cert = "/run/builder-tls/cert.pem"
        key = "/run/builder-tls/key.pem"
        ca = "/run/builder-tls/ca.pem"
    [dns]
      nameservers = ["1.1.1.1", "8.8.8.8"]
    [worker.oci]
      enabled = true
      networkMode = "cni"
      cniConfigPath = "/etc/buildkit/cni.conflist"
      cniBinaryPath = "${pkgs.cni-plugins}/bin"
      max-parallelism = 2
      gc = true
      reservedSpace = "1GB"
      maxUsedSpace = "8GB"
      minFreeSpace = "3GB"
    [worker.containerd]
      enabled = false
    [registry."127.0.0.1:15000"]
      http = true
    [history]
      maxAge = 86400
      maxEntries = 20
  '';
  environment.etc."buildkit/cni.conflist".text = builtins.toJSON {
    cniVersion = "1.0.0";
    name = "buildkit";
    plugins = [
      { type = "bridge"; bridge = "buildkit0"; isGateway = true; ipMasq = true;
        ipam = { type = "host-local"; ranges = [[ { subnet = "172.30.0.0/24"; } ]];
          routes = [ { dst = "0.0.0.0/0"; } ]; }; }
      { type = "firewall"; backend = "iptables"; }
    ];
  };
  systemd.services.buildkit = {
    wantedBy = [ "multi-user.target" ];
    after = [ "network-online.target" "builder-credentials.service" ];
    wants = [ "network-online.target" ];
    path = with pkgs; [ runc git iproute2 iptables ];
    serviceConfig = {
      ExecStart = "${pkgs.buildkit}/bin/buildkitd --config /etc/buildkit/buildkitd.toml";
      Restart = "on-failure";
      StateDirectory = "buildkit";
      Delegate = true;
      TasksMax = 1024;
      MemoryMax = "2400M";
      LimitNOFILE = 65536;
      RestartSec = 3;
    };
  };
  # Disposable development registry only; never use this for production images.
  services.dockerRegistry = {
    enable = true;
    listenAddress = "0.0.0.0";
    port = 15000;
    enableDelete = false;
    enableGarbageCollect = false;
    extraConfig.storage.maintenance.uploadpurging = {
      enabled = true;
      age = "24h";
      interval = "1h";
      dryrun = false;
    };
  };
  systemd.services.docker-registry.serviceConfig.StandardOutput = "journal+console";
  systemd.services.docker-registry.serviceConfig.StandardError = "journal+console";
  # Boot diagnostics remain on the private host journal, without an SSH service.
  systemd.services.builder-diagnostics = {
    wantedBy = [ "multi-user.target" ];
    after = [ "buildkit.service" "docker-registry.service" ];
    serviceConfig = { Type = "oneshot"; StandardOutput = "journal+console"; };
    script = ''
      sleep 2
      ${pkgs.systemd}/bin/journalctl --no-pager -n 40 -u buildkit -u docker-registry -u register-nix-paths > /dev/ttyS0
    '';
  };
  services.journald.extraConfig = "SystemMaxUse=128M\nRuntimeMaxUse=64M\nForwardToConsole=yes\nMaxLevelConsole=warning";
}
