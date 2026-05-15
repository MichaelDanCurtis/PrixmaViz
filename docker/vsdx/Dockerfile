# Build a slim LibreOffice + unoserver image for vsdx → SVG conversion.
FROM ubuntu@sha256:c4a8d5503dfb2a3eb8ab5f807da5bc69a85730fb49b5cfca2330194ebcc41c7b

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      libreoffice-draw \
      libreoffice-core \
      python3 \
      python3-pip \
      python3-venv \
      python3-uno \
      ca-certificates \
      wget \
      tini \
    && rm -rf /var/lib/apt/lists/*

# Install unoserver in a venv that inherits system site-packages.
# Required: the `uno` module ships with LibreOffice's python3-uno apt package
# and lives in /usr/lib/python3/dist-packages. A clean venv (no inheritance)
# can't import it, so unoserver crashes on startup with "No module named 'uno'".
RUN python3 -m venv --system-site-packages /opt/unoserver-venv && \
    /opt/unoserver-venv/bin/pip install --no-cache-dir unoserver==3.2

ENV PATH="/opt/unoserver-venv/bin:${PATH}"

COPY shim.py /opt/shim.py

EXPOSE 2003
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://localhost:2003/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python3", "/opt/shim.py"]
