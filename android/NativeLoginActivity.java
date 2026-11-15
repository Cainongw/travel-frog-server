package com.cainong.travelfrog;

import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.text.InputType;
import android.view.View;
import android.view.Gravity;
import android.widget.*;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.*;

/** Private-server login using Android widgets. Never stores a password. */
public class NativeLoginActivity extends Activity {
    private static final String ORIGIN="https://travelfrog.caiw.pp.ua:8133";
    private SharedPreferences prefs;
    private EditText username,password;
    private TextView message;
    private Button login;
    private boolean cancelled=false;

    @Override public void onCreate(Bundle state){
        super.onCreate(state);prefs=getSharedPreferences("frog_login",MODE_PRIVATE);
        boolean switchAccount=getIntent().getBooleanExtra("switch_account",false)||getIntent().getData()!=null;
        if(switchAccount){prefs.edit().remove("refresh_token").commit();clearSession();}
        showForm();
        String refresh=prefs.getString("refresh_token","");
        if(!refresh.isEmpty()&&!switchAccount){
            message.setText("正在恢复登录…");login.setEnabled(false);
            request("/api/game/refresh",json("refresh_token",refresh),true);
        }
    }
    private JSONObject json(String key,String value){JSONObject out=new JSONObject();try{out.put(key,value);}catch(Exception ignored){}return out;}
    private int dp(int value){return (int)(value*getResources().getDisplayMetrics().density+0.5f);}
    private void showForm(){
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setGravity(Gravity.CENTER);root.setPadding(dp(30),dp(25),dp(30),dp(25));root.setBackgroundColor(Color.rgb(246,243,230));
        TextView title=new TextView(this);title.setText("旅行青蛙·狗狗特供版");title.setTextSize(25);title.setGravity(Gravity.CENTER);title.setTextColor(Color.rgb(52,78,59));root.addView(title);
        TextView subtitle=new TextView(this);subtitle.setText("登录后会自动记住，下次直接进入游戏");subtitle.setTextSize(14);subtitle.setPadding(0,dp(15),0,dp(25));subtitle.setGravity(Gravity.CENTER);root.addView(subtitle);
        username=new EditText(this);username.setSingleLine(true);username.setHint("游戏账号");username.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);username.setText(prefs.getString("username",""));root.addView(username,new LinearLayout.LayoutParams(-1,dp(56)));
        password=new EditText(this);password.setSingleLine(true);password.setHint("密码");password.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);root.addView(password,new LinearLayout.LayoutParams(-1,dp(56)));
        message=new TextView(this);message.setTextSize(14);message.setTextColor(Color.rgb(160,55,40));message.setPadding(0,dp(16),0,dp(12));root.addView(message);
        login=new Button(this);login.setText("登录并进入游戏");root.addView(login,new LinearLayout.LayoutParams(-1,dp(54)));
        login.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            String name=username.getText().toString().trim(),pass=password.getText().toString();
            if(name.isEmpty()||pass.isEmpty()){message.setText("请输入账号和密码");return;}
            JSONObject body=json("username",name);try{body.put("password",pass);}catch(Exception ignored){}
            login.setEnabled(false);message.setText("正在登录…");request("/api/game/login",body,false);
        }});
        setContentView(root);
    }
    private void request(final String path,final JSONObject body,final boolean restoring){new Thread(new Runnable(){public void run(){
        try{
            HttpURLConnection connection=(HttpURLConnection)new URL(ORIGIN+path).openConnection();connection.setConnectTimeout(15000);connection.setReadTimeout(15000);connection.setInstanceFollowRedirects(false);connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");
            try{byte[] bytes=body.toString().getBytes("UTF-8");connection.setFixedLengthStreamingMode(bytes.length);OutputStream out=connection.getOutputStream();out.write(bytes);out.close();
                int status=connection.getResponseCode();InputStream in=status<400?connection.getInputStream():connection.getErrorStream();ByteArrayOutputStream buffer=new ByteArrayOutputStream();byte[] part=new byte[4096];int n;while(in!=null&&(n=in.read(part))!=-1){buffer.write(part,0,n);if(buffer.size()>65536)throw new IOException("响应过大");}if(in!=null)in.close();
                final JSONObject data=new JSONObject(new String(buffer.toByteArray(),"UTF-8"));
                if(status!=200||!data.has("token")){if(restoring&&status==401)prefs.edit().remove("refresh_token").commit();throw new IOException(data.optString("error","登录失败，请重试"));}
                final String name=body.optString("username",prefs.getString("username",""));
                if(data.has("refresh_token"))prefs.edit().putString("refresh_token",data.getString("refresh_token")).putString("username",name).commit();
                writeSession(data);
                runOnUiThread(new Runnable(){public void run(){if(cancelled||isFinishing())return;password.setText("");Intent game=new Intent();game.setClassName(getPackageName(),"com.Aligames.lxqw.MainActivity");startActivity(game);finish();}});
            }finally{connection.disconnect();}
        }catch(final Exception error){runOnUiThread(new Runnable(){public void run(){if(cancelled||isFinishing())return;login.setEnabled(true);message.setText(restoring?"自动登录未完成，请检查网络或重新输入密码":error.getMessage());}});}
    }}).start();}
    private void writeSession(JSONObject data)throws Exception{
        File dir=new File(getFilesDir(),"jsdata");if(!dir.exists()&&!dir.mkdirs())throw new IOException("无法保存登录会话");
        JSONObject session=new JSONObject();session.put("token",data.getString("token"));session.put("account",data.getString("account"));
        File file=new File(dir,"frog-native-session.json");FileOutputStream out=new FileOutputStream(file);try{out.write(session.toString().getBytes("UTF-8"));}finally{out.close();}
    }
    private void clearSession(){new File(new File(getFilesDir(),"jsdata"),"frog-native-session.json").delete();}
    @Override public void onDestroy(){cancelled=true;super.onDestroy();}
}
