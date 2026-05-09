class PrixmavizServer < Formula
  desc "AI-native diagram tool MCP server"
  homepage "https://github.com/MichaelDanCurtis/PrixmaViz"
  version "0.2.0"

  on_macos do
    on_arm do
      url "https://github.com/MichaelDanCurtis/PrixmaViz/releases/download/v0.2.0/prixmaviz-server-darwin-arm64"
      sha256 "REPLACE_WITH_SHA"
    end
    on_intel do
      url "https://github.com/MichaelDanCurtis/PrixmaViz/releases/download/v0.2.0/prixmaviz-server-darwin-x64"
      sha256 "REPLACE_WITH_SHA"
    end
  end

  on_linux do
    url "https://github.com/MichaelDanCurtis/PrixmaViz/releases/download/v0.2.0/prixmaviz-server-linux-x64"
    sha256 "REPLACE_WITH_SHA"
  end

  def install
    bin.install Dir["prixmaviz-server-*"][0] => "prixmaviz-server"
  end

  test do
    system "#{bin}/prixmaviz-server", "--version"
  end
end
