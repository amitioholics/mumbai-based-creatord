import os
import sys
import webbrowser
import socket
import pandas as pd
import gspread
from google.oauth2.service_account import Credentials
from flask import Flask, request, jsonify, render_template

app = Flask(__name__, template_folder='templates', static_folder='static')

# Configuration
CREDENTIALS_FILE = "credentials.json"
SPREADSHEET_NAME_CONFIG = "mumbai creators"

import json

def get_gspread_client():
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive"
    ]
    
    # 1. Try loading from environment variable (best for secure cloud deployments)
    creds_json_str = os.environ.get("GOOGLE_CREDENTIALS")
    if creds_json_str:
        try:
            creds_info = json.loads(creds_json_str)
            client_email = creds_info.get("client_email")
            print(f"DEBUG: Loaded credentials from env var. Client email: {client_email}")
            creds = Credentials.from_service_account_info(creds_info, scopes=scopes)
            return gspread.authorize(creds)
        except Exception as e:
            print(f"Warning: Failed to parse GOOGLE_CREDENTIALS env var: {str(e)}")
            
    # 2. Fall back to credentials.json file
    if not os.path.exists(CREDENTIALS_FILE):
        raise FileNotFoundError(
            f"Google credentials file '{CREDENTIALS_FILE}' not found and "
            "GOOGLE_CREDENTIALS environment variable is not set."
        )
    creds = Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=scopes)
    print(f"DEBUG: Loaded credentials from file. Client email: {creds.service_account_email}")
    return gspread.authorize(creds)

def get_spreadsheet(client):
    # 1. Try to open the configured name
    try:
        return client.open(SPREADSHEET_NAME_CONFIG)
    except Exception:
        pass
        
    try:
        return client.open("Mumbai based users - haulpack")
    except Exception:
        pass

    # 2. Try to list all spreadsheets and match title
    try:
        sheets = client.openall()
        if sheets:
            # Look for any sheet containing 'mumbai' or 'haulpack'
            for sheet in sheets:
                title = sheet.title.lower()
                if "mumbai" in title or "haulpack" in title:
                    print(f"Automatically selected Google Sheet matching pattern: '{sheet.title}'")
                    return sheet
            # If not found, return the first one
            print(f"Automatically selected first available Google Sheet: '{sheets[0].title}'")
            return sheets[0]
    except Exception as e:
        print(f"Error listing spreadsheets: {str(e)}")
        
    raise FileNotFoundError(
        "Could not find any Google Sheets. Please ensure you have shared the sheet "
        "with the Service Account email address."
    )

def col_num_to_letter(col_num):
    letter = ""
    while col_num > 0:
        col_num, remainder = divmod(col_num - 1, 26)
        letter = chr(65 + remainder) + letter
    return letter

def extract_username(instagram_link, default_username='unknown'):
    if not instagram_link or instagram_link == '0' or str(instagram_link).lower() == 'nan':
        return default_username
    
    link = str(instagram_link).strip()
    if 'instagram.com/' in link:
        try:
            path = link.split('instagram.com/')[1]
            username = path.split('?')[0]
            username = username.strip('/')
            if username:
                return username
        except Exception:
            pass
    return default_username

def load_data_from_sheets():
    client = get_gspread_client()
    sheet = get_spreadsheet(client)
    worksheet = sheet.get_worksheet(0) # Get first tab
    
    # Get all values including empty rows to keep row index mapping direct and exact
    all_values = worksheet.get_all_values()
    if not all_values:
        raise Exception("The Google Sheet is completely empty!")
        
    headers = [str(h).strip() for h in all_values[0]]
    data_rows = all_values[1:]
    
    df = pd.DataFrame(data_rows, columns=headers)
    
    # Add review columns if they don't exist in headers list
    headers_updated = False
    if 'Review Decision' not in headers:
        headers.append('Review Decision')
        headers_updated = True
    if 'Review Remarks' not in headers:
        headers.append('Review Remarks')
        headers_updated = True
        
    if headers_updated:
        # Update row 1 with new headers list
        range_name = f"A1:{col_num_to_letter(len(headers))}1"
        worksheet.update(range_name=range_name, values=[headers])
        # Re-fetch data rows with updated DataFrame columns
        df = pd.DataFrame(data_rows, columns=headers[:-2])
        df['Review Decision'] = ''
        df['Review Remarks'] = ''
        
    # Clean/standardize values
    df['Review Decision'] = df['Review Decision'].fillna('').astype(str).str.strip()
    df['Review Remarks'] = df['Review Remarks'].fillna('').astype(str).str.strip()
    
    # Ensure critical fields have standard types
    if 'instagramLink' in df.columns:
        df['instagramLink'] = df['instagramLink'].fillna('').astype(str).str.strip()
    else:
        df['instagramLink'] = ''
        
    # Detect GMV / total amount column dynamically
    gmv_col = None
    for col in ['Overall GMV', 'totalAmount', 'total_amount', 'GMV']:
        if col in df.columns:
            gmv_col = col
            break
            
    if gmv_col:
        df['Overall GMV_Normalized'] = pd.to_numeric(df[gmv_col].fillna(0), errors='coerce').fillna(0)
    else:
        df['Overall GMV_Normalized'] = 0.0

    if 'igFollowersCount' in df.columns:
        df['igFollowersCount'] = pd.to_numeric(df['igFollowersCount'].fillna(0), errors='coerce').fillna(0).astype(int)
    else:
        df['igFollowersCount'] = 0

    if 'ytSubscribersCount' in df.columns:
        df['ytSubscribersCount'] = pd.to_numeric(df['ytSubscribersCount'].fillna(0), errors='coerce').fillna(0).astype(int)
    else:
        df['ytSubscribersCount'] = 0

    # Clean Phone numbers (remove trailing .0 if present)
    phone_cleaned = []
    if 'Phone' in df.columns:
        for val in df['Phone']:
            s = str(val).strip()
            if not s or s == '0' or s.lower() == 'nan' or s.lower() == 'none':
                phone_cleaned.append('')
            else:
                if s.endswith('.0'):
                    s = s[:-2]
                phone_cleaned.append(s)
    else:
        phone_cleaned = [''] * len(df)
    df['Phone_Cleaned'] = phone_cleaned

    if 'igUserName' in df.columns:
        df['igUserName'] = df['igUserName'].fillna('').astype(str).str.strip()
    else:
        df['igUserName'] = ''

    return df, worksheet, headers

@app.route('/')
def index():
    has_file = os.path.exists(CREDENTIALS_FILE)
    has_env = os.environ.get("GOOGLE_CREDENTIALS") is not None
    if not (has_file or has_env):
        return render_template('instructions.html')
    return render_template('index.html')

@app.route('/api/profiles', methods=['GET'])
def get_profiles():
    try:
        df, _, _ = load_data_from_sheets()
        
        profiles = []
        for idx, row in df.iterrows():
            instalink = row.get('instagramLink', '')
            if not instalink or instalink == '0' or instalink.lower() == 'nan':
                continue
                
            # Fallback for username if it's '0' or empty
            username = str(row.get('igUserName', '')).strip()
            if not username or username == '0' or username.lower() == 'nan':
                username = extract_username(instalink, 'unknown')
                
            # Create profile dict
            profile = {
                'index': int(idx),
                'gender': str(row.get('Gender', '')),
                'email': str(row.get('Email', '')),
                'phone': str(row.get('Phone_Cleaned', '')),
                'instagramLink': instalink,
                'igFollowersCount': int(row.get('igFollowersCount', 0)),
                'youtubeLink': str(row.get('youtubeLink', '')) if pd.notna(row.get('youtubeLink')) else '',
                'ytSubscribersCount': int(row.get('ytSubscribersCount', 0)),
                'overallGmv': float(row.get('Overall GMV_Normalized', 0.0)),
                'igUserName': username,
                'contentCategories': str(row.get('contentCategories', '')) if pd.notna(row.get('contentCategories')) else '',
                'primaryLanguages': str(row.get('primaryLanguages', '')) if pd.notna(row.get('primaryLanguages')) else '',
                'reviewDecision': str(row.get('Review Decision', '')),
                'reviewRemarks': str(row.get('Review Remarks', ''))
            }
            profiles.append(profile)
            
        return jsonify({
            'status': 'success',
            'count': len(profiles),
            'profiles': profiles
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/api/review', methods=['POST'])
def save_review():
    try:
        data = request.json
        if not data or 'index' not in data or 'decision' not in data:
            return jsonify({'status': 'error', 'message': 'Missing index or decision'}), 400
            
        idx = int(data['index'])
        decision = str(data['decision']).strip()
        remarks = str(data.get('remarks', '')).strip()
        
        df, worksheet, headers = load_data_from_sheets()
        if idx < 0 or idx >= len(df):
            return jsonify({'status': 'error', 'message': 'Invalid row index'}), 400
            
        # Update row index in Google Sheet (Header is row 1, data starts at row 2)
        sheet_row_num = idx + 2
        
        # Get column indices (1-indexed for gspread)
        decision_col_idx = headers.index('Review Decision') + 1
        remarks_col_idx = headers.index('Review Remarks') + 1
        
        # Save to Google Sheets
        # Check if contiguous to optimize with a single range update request
        if remarks_col_idx == decision_col_idx + 1:
            dec_let = col_num_to_letter(decision_col_idx)
            rem_let = col_num_to_letter(remarks_col_idx)
            range_name = f"{dec_let}{sheet_row_num}:{rem_let}{sheet_row_num}"
            worksheet.update(range_name=range_name, values=[[decision, remarks]])
        else:
            worksheet.update_cell(sheet_row_num, decision_col_idx, decision)
            worksheet.update_cell(sheet_row_num, remarks_col_idx, remarks)
            
        return jsonify({
            'status': 'success',
            'message': 'Google Sheet updated successfully!',
            'data': {
                'index': idx,
                'reviewDecision': decision,
                'reviewRemarks': remarks
            }
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f"Failed to save to Google Sheets: {str(e)}"
        }), 500

@app.route('/api/open-profile', methods=['POST'])
def open_profile():
    try:
        data = request.json
        if not data or 'url' not in data:
            return jsonify({'status': 'error', 'message': 'Missing URL'}), 400
            
        url = str(data['url']).strip()
        if url and url != '0' and url.lower() != 'nan':
            webbrowser.open(url)
            return jsonify({'status': 'success', 'message': f'Opened link: {url}'})
        else:
            return jsonify({'status': 'error', 'message': 'Invalid URL'}), 400
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

if __name__ == '__main__':
    local_ip = get_local_ip()
    print("*" * 60)
    print("  Instagram Review Automation Running Network-Wide!")
    print(f"  Local access:   http://127.0.0.1:5000")
    print(f"  Network access: http://{local_ip}:5000")
    print("  Press Ctrl+C to stop.")
    print("*" * 60)
    app.run(host='0.0.0.0', port=5000, debug=True)
