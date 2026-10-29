FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# System packages only. The repository is checked out by Cursor, not copied here.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        fontconfig \
        fonts-font-awesome \
        git \
        latexmk \
        lmodern \
        poppler-utils \
        texlive-fonts-extra \
        texlive-fonts-recommended \
        texlive-xetex \
    && rm -rf /var/lib/apt/lists/*
