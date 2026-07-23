import os
import glob
import pandas as pd
import gspread
from google.oauth2.service_account import Credentials

CREDENTIALS_FILE = "credentials.json"

def find_excel_file():
    files = glob.glob("Mumbai based users - haulpack*.xlsx")
    if not files:
        files = glob.glob("*.xlsx")
    if not files:
        raise FileNotFoundError("No Excel spreadsheet (.xlsx) found in the current directory.")
    files.sort(key=lambda x: (os.path.getmtime(x), x), reverse=True)
    return files[0]

def get_gspread_client():
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive"
    ]
    creds = Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=scopes)
    return gspread.authorize(creds)

def col_num_to_letter(col_num):
    letter = ""
    while col_num > 0:
        col_num, remainder = divmod(col_num - 1, 26)
        letter = chr(65 + remainder) + letter
    return letter

def copy_excel_to_google_sheet():
    print("Connecting to Google Sheets API...")
    client = get_gspread_client()
    
    # List all spreadsheets shared with the service account
    sheets = client.openall()
    if not sheets:
        print("\n" + "!" * 50)
        print("ERROR: No Google Sheets found shared with the service account.")
        print("Please share your Google Sheet with this email address as an 'Editor':")
        print("  sheet-editor@halogen-framing-471803-e3.iam.gserviceaccount.com")
        print("!" * 50 + "\n")
        return
        
    print("\nAvailable Google Sheets:")
    for idx, s in enumerate(sheets):
        print(f"[{idx}] {s.title}")
        
    # Automatically pick the best spreadsheet or let the user know
    selected_sheet = None
    for s in sheets:
        title = s.title.lower()
        if "mumbai" in title or "haulpack" in title:
            selected_sheet = s
            break
            
    if not selected_sheet:
        selected_sheet = sheets[0]
        
    print(f"\nSelected Target Spreadsheet: '{selected_sheet.title}'")
    
    excel_file = find_excel_file()
    print(f"Reading local Excel file: '{excel_file}'...")
    
    # Read excel file
    df = pd.read_excel(excel_file)
    
    # Add Review columns if they don't exist
    if 'Review Decision' not in df.columns:
        df['Review Decision'] = ''
    if 'Review Remarks' not in df.columns:
        df['Review Remarks'] = ''
        
    # Replace NaN with empty strings to avoid json errors
    df = df.fillna('')
    
    # Convert all columns to standard strings or numbers
    for col in df.columns:
        df[col] = df[col].astype(str)
        
    # Prepare data for gspread (headers + rows)
    headers = list(df.columns)
    rows = df.values.tolist()
    data_to_write = [headers] + rows
    
    worksheet = selected_sheet.get_worksheet(0)
    print("Clearing target sheet...")
    worksheet.clear()
    
    print(f"Writing {len(rows)} rows of data...")
    # Update sheet (starting from A1)
    range_label = f"A1:{col_num_to_letter(len(headers))}{len(data_to_write)}"
    worksheet.update(range_name=range_label, values=data_to_write)
    
    print("\n" + "*" * 50)
    print("SUCCESS: Data successfully copied to Google Sheet!")
    print("*" * 50 + "\n")

if __name__ == '__main__':
    try:
        copy_excel_to_google_sheet()
    except Exception as e:
        print(f"An error occurred: {str(e)}")
