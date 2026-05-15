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
      ca-certificates \
      wget \
      tini \
    && rm -rf /var/lib/apt/lists/*

# Install unoserver in a venv (Ubuntu 24.04 requires --break-system-packages
# or a venv for pip installs).
RUN python3 -m venv /opt/unoserver-venv && \
    /opt/unoserver-venv/bin/pip install --no-cache-dir unoserver==3.2

ENV PATH="/opt/unoserver-venv/bin:${PATH}"

COPY shim.py /opt/shim.py

EXPOSE 2003
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://localhost:2003/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python3", "/opt/shim.py"]
