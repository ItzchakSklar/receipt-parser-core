FROM python:3.11-slim

# Tesseract + Hebrew language pack for OCR (see app/services/ocr_service.py). The
# app looks for heb.traineddata/eng.traineddata under
# $LOCALAPPDATA/SmartReceipt/tessdata (a Windows-dev-machine convention, not
# Tesseract's own tessdata dir) and falls back to English-only recognition if
# they're missing there - so the apt-installed language files are copied into
# that exact layout and LOCALAPPDATA is pointed at it below.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-heb \
    && rm -rf /var/lib/apt/lists/*

# Microsoft ODBC Driver 18 for SQL Server, required by pyodbc (DATABASE_URL=mssql+pyodbc://...).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl gnupg unixodbc \
    && curl -sSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
    && curl -sSL https://packages.microsoft.com/config/debian/12/prod.list \
       | sed 's#deb #deb [signed-by=/usr/share/keyrings/microsoft-prod.gpg] #' \
       > /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 \
    && rm -rf /var/lib/apt/lists/*

ENV LOCALAPPDATA=/opt/smartreceipt-appdata
RUN TESSDATA_SRC="$(dirname "$(find /usr/share/tesseract-ocr -name eng.traineddata | head -n1)")" \
    && mkdir -p "$LOCALAPPDATA/SmartReceipt/tessdata" \
    && cp "$TESSDATA_SRC/eng.traineddata" "$TESSDATA_SRC/heb.traineddata" "$LOCALAPPDATA/SmartReceipt/tessdata/"

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN mkdir -p uploads sent_emails

EXPOSE 8000
# Shell form (not exec-form array) so $PORT - injected by Render at runtime - is
# actually substituted; falls back to 8000 for `docker run` without PORT set.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
