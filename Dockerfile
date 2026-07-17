FROM python:3.12-slim
WORKDIR /app
COPY server.py ./
COPY public ./public
ENV PORT=4000
EXPOSE 4000
# Data (accounts, checklists) lives in /app/data — mount a persistent volume there.
VOLUME /app/data
CMD ["python", "server.py"]
