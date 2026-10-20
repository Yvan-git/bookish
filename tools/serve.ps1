<#
  Tiny static file server used to run the app + simulator + laptop workspace
  on this machine (the camera, the service worker and the module imports all
  need an http:// origin - file:// will not work).

  Usage:
    powershell -ExecutionPolicy Bypass -File tools\serve.ps1
    powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Port 8080
    powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Lan

  Then open:
    http://localhost:8080/app/simulator.html   (desktop simulator)
    http://localhost:8080/app/index.html        (the app itself)
    http://localhost:8080/laptop/index.html     (laptop workspace)

  -Lan also listens on the network interface, so a phone on the same Wi-Fi can
  reach http://<this-machine-ip>:<port>/app/index.html . Note that the camera
  needs a *secure* context (https) or localhost, so over the plain LAN address
  everything works except the camera - use tools\tunnel.ps1 for that.

  Implementation note: the listener is a TcpListener (binding a non-localhost
  prefix with HttpListener would need an administrator URL reservation) and
  every accepted client is served on its own background thread. That matters:
  with a single-threaded accept loop one idle keep-alive connection stalls
  every other request, which used to make the jsQR fallback script hang.
#>
param(
  [int]$Port = 8080,
  [string]$Root = (Join-Path $PSScriptRoot '..'),
  [switch]$Lan
)

$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath($Root)

$serverSource = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

public static class BookishStaticServer
{
    private static string _root;
    private static string _rootPrefix;
    private static Dictionary<string, string> _mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    private static TcpListener _listener;
    private static volatile bool _running = true;

    public static void Configure(string root, IDictionary<string, string> mime)
    {
        _root = Path.GetFullPath(root);
        _rootPrefix = _root.EndsWith(Path.DirectorySeparatorChar.ToString())
            ? _root
            : _root + Path.DirectorySeparatorChar;
        foreach (KeyValuePair<string, string> kv in mime) { _mime[kv.Key] = kv.Value; }
    }

    public static void Listen(int port, bool lan)
    {
        IPAddress addr = lan ? IPAddress.Any : IPAddress.Loopback;
        _listener = new TcpListener(addr, port);
        _listener.Start();
        while (_running)
        {
            TcpClient client;
            try { client = _listener.AcceptTcpClient(); }
            catch (SocketException) { if (_running) continue; break; }
            catch (InvalidOperationException) { break; }
            TcpClient captured = client;
            Thread worker = new Thread(new ThreadStart(delegate { Serve(captured); }));
            worker.IsBackground = true;
            worker.Start();
        }
    }

    public static void Stop()
    {
        _running = false;
        try { if (_listener != null) { _listener.Stop(); } } catch { }
    }

    private static void Log(string message)
    {
        Console.WriteLine("[{0}] {1}", DateTime.Now.ToString("HH:mm:ss"), message);
        Console.Out.Flush();
    }

    private static void Serve(TcpClient client)
    {
        try
        {
            client.ReceiveTimeout = 8000;
            client.SendTimeout = 8000;
            client.NoDelay = true;
            using (NetworkStream stream = client.GetStream())
            {
                byte[] buffer = new byte[16384];
                MemoryStream ms = new MemoryStream();
                string head = null;
                while (true)
                {
                    int n = stream.Read(buffer, 0, buffer.Length);
                    if (n <= 0) { break; }
                    ms.Write(buffer, 0, n);
                    head = Encoding.ASCII.GetString(ms.ToArray());
                    if (head.Contains("\r\n\r\n")) { break; }
                    if (ms.Length > 65536) { break; }
                }
                ms.Dispose();
                if (string.IsNullOrEmpty(head)) { return; }

                string[] lines = head.Split(new string[] { "\r\n" }, StringSplitOptions.None);
                string[] parts = lines[0].Split(' ');
                if (parts.Length < 2)
                {
                    WriteRaw(stream, 400, "Bad Request", "text/plain; charset=utf-8",
                        Encoding.UTF8.GetBytes("400 - bad request"), false);
                    return;
                }
                string method = parts[0].ToUpperInvariant();
                string path = parts[1];
                int q = path.IndexOf('?');
                if (q >= 0) { path = path.Substring(0, q); }
                try { path = Uri.UnescapeDataString(path); } catch { }
                if (path == "/") { path = "/app/index.html"; }

                string relative = path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
                string full = Path.GetFullPath(Path.Combine(_root, relative));

                if (!full.StartsWith(_rootPrefix, StringComparison.OrdinalIgnoreCase))
                {
                    Log("403 " + path);
                    WriteRaw(stream, 403, "Forbidden", "text/plain; charset=utf-8",
                        Encoding.UTF8.GetBytes("403 - forbidden"), method == "HEAD");
                    return;
                }
                if (Directory.Exists(full)) { full = Path.Combine(full, "index.html"); }
                if (!File.Exists(full))
                {
                    Log("404 " + path);
                    WriteRaw(stream, 404, "Not Found", "text/plain; charset=utf-8",
                        Encoding.UTF8.GetBytes("404 - " + path), method == "HEAD");
                    return;
                }

                string ext = Path.GetExtension(full).ToLowerInvariant();
                string type;
                if (!_mime.TryGetValue(ext, out type)) { type = "application/octet-stream"; }
                byte[] bytes = File.ReadAllBytes(full);
                Log("200 " + path + " (" + bytes.Length + " o)");
                WriteRaw(stream, 200, "OK", type, bytes, method == "HEAD");
            }
        }
        catch (Exception ex) { Log("ERROR " + ex.Message); }
        finally { try { client.Close(); } catch { } }
    }

    private static void WriteRaw(NetworkStream stream, int code, string status, string type,
                                 byte[] body, bool headOnly)
    {
        string head = "HTTP/1.1 " + code + " " + status + "\r\n" +
                      "Content-Type: " + type + "\r\n" +
                      "Content-Length: " + body.Length + "\r\n" +
                      "Cache-Control: no-store\r\n" +
                      "Connection: close\r\n\r\n";
        byte[] headBytes = Encoding.ASCII.GetBytes(head);
        stream.Write(headBytes, 0, headBytes.Length);
        if (!headOnly && body.Length > 0) { stream.Write(body, 0, body.Length); }
        stream.Flush();
    }
}
'@

if (-not ('BookishStaticServer' -as [type])) {
  Add-Type -TypeDefinition $serverSource -Language CSharp
}

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.mjs'  = 'application/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.webp' = 'image/webp'
  '.woff' = 'font/woff'
  '.woff2' = 'font/woff2'
  '.ttf'  = 'font/ttf'
  '.xlsx' = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  '.txt'  = 'text/plain; charset=utf-8'
}

function Write-Log($msg) {
  Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg)
}

function Get-LanAddresses {
  try {
    [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
      Where-Object { $_.OperationalStatus -eq 'Up' -and $_.NetworkInterfaceType -ne 'Loopback' } |
      ForEach-Object { $_.GetIPProperties().UnicastAddresses } |
      Where-Object { $_.Address.AddressFamily -eq 'InterNetwork' } |
      ForEach-Object { $_.Address.IPAddressToString }
  } catch { @() }
}

$mimeMap = New-Object 'System.Collections.Generic.Dictionary[string,string]'
foreach ($key in $mime.Keys) { $mimeMap[[string]$key] = [string]$mime[$key] }
[BookishStaticServer]::Configure($Root, $mimeMap)

Write-Log "Serving $Root"
Write-Log "  app       -> http://localhost:$Port/app/index.html"
Write-Log "  simulator -> http://localhost:$Port/app/simulator.html"
Write-Log "  laptop    -> http://localhost:$Port/laptop/index.html"
if ($Lan) {
  foreach ($ip in (Get-LanAddresses)) {
    Write-Log "  reseau    -> http://$ip`:$Port/app/index.html  (camera indisponible en http simple)"
  }
}
Write-Log "Ctrl+C to stop."

try {
  [BookishStaticServer]::Listen($Port, [bool]$Lan)
} finally {
  [BookishStaticServer]::Stop()
}
