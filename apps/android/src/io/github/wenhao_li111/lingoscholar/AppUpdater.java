package io.github.wenhao_li111.lingoscholar;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.widget.TextView;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.Arrays;

/** User-initiated HTTPS updates. No silent installs or certificate bypasses. */
public final class AppUpdater {
    private static final String BASE="https://wenhao-li111.github.io/lingo-scholar/downloads/";
    private final Activity activity;
    private final TextView status;
    private boolean busy;
    AppUpdater(Activity a,TextView s){activity=a;status=s;}
    private void ui(Runnable r){activity.runOnUiThread(()->{if(!activity.isFinishing()&&!activity.isDestroyed())r.run();});}
    private void say(String s){ui(()->status.setText(s));}
    private static String hex(byte[] b){StringBuilder s=new StringBuilder();for(byte v:b)s.append(String.format("%02x",v&255));return s.toString();}
    private static HttpURLConnection connect(String url) throws Exception {
        if (!url.startsWith(BASE) || !new URI(url).getHost().equals("wenhao-li111.github.io")) throw new IOException("不可信的下载地址");
        HttpURLConnection c=(HttpURLConnection)new URL(url).openConnection();
        c.setConnectTimeout(15000);c.setReadTimeout(20000);c.setInstanceFollowRedirects(false);
        c.setRequestProperty("Cache-Control","no-cache");
        if(c.getResponseCode()!=200){c.disconnect();throw new IOException("下载服务暂时不可用");}return c;
    }
    public void check(){
        if(busy)return;busy=true;say("正在检查新版本…");
        new Thread(()->{try{
            HttpURLConnection c=connect(BASE+"latest.json");
            ByteArrayOutputStream buffer=new ByteArrayOutputStream();
            try(InputStream in=c.getInputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){buffer.write(b,0,n);if(buffer.size()>65536)throw new IOException("版本信息过大");}}finally{c.disconnect();}
            JSONObject m=new JSONObject(buffer.toString("UTF-8"));
            int installed=activity.getPackageManager().getPackageInfo(activity.getPackageName(),0).versionCode;
            int version=m.getInt("versionCode");String name=m.getString("versionName"), hash=m.getString("sha256"), file=m.getString("file");
            long bytes=m.getLong("bytes");
            if(!file.matches("lingo-scholar-[0-9]+\\.[0-9]+\\.[0-9]+\\.apk")||!hash.matches("[a-f0-9]{64}")||bytes<=0||bytes>50*1024*1024)throw new IOException("版本信息格式错误");
            if(version<=installed){say("已是最新安装版。学习网页功能由服务器独立更新。");ui(()->busy=false);return;}
            ui(()->{busy=false;new AlertDialog.Builder(activity).setTitle("发现新版本 "+name)
                .setMessage(m.optString("notes","更新安装版")+"\n下载大小："+bytes/1024+" KB\n下载完成后由系统确认安装。")
                .setNegativeButton("稍后",null).setPositiveButton("下载新版",(d,w)->download(BASE+file,hash,bytes,version)).show();});
        }catch(Exception e){say("检查失败，请检查网络后重试。");ui(()->busy=false);}},"lingo-update-check").start();
    }
    private void download(String url,String expected,long size,int version){
        if(busy)return;busy=true;say("开始下载…");
        new Thread(()->{
            File part=new File(activity.getFilesDir(),"update.part"), apk=new File(activity.getFilesDir(),"update.apk");
            try{
                HttpURLConnection c=connect(url);MessageDigest hash=MessageDigest.getInstance("SHA-256");long total=0;
                try(InputStream in=c.getInputStream();OutputStream out=new FileOutputStream(part)){
                    byte[] b=new byte[32768];int n,last=-1;while((n=in.read(b))!=-1){total+=n;if(total>size)throw new IOException("大小不匹配");out.write(b,0,n);hash.update(b,0,n);int percent=(int)(total*100/size);if(percent!=last){say("正在下载 "+percent+"%");last=percent;}}
                }finally{c.disconnect();}
                if(total!=size||!hex(hash.digest()).equals(expected))throw new IOException("校验不匹配");
                PackageManager pm=activity.getPackageManager();
                PackageInfo next=pm.getPackageArchiveInfo(part.getAbsolutePath(),PackageManager.GET_SIGNATURES);
                PackageInfo own=pm.getPackageInfo(activity.getPackageName(),PackageManager.GET_SIGNATURES);
                if(next==null||!own.packageName.equals(next.packageName)||next.versionCode!=version||version<=own.versionCode||!Arrays.equals(own.signatures,next.signatures))throw new IOException("安装包签名或版本不匹配");
                if(!part.renameTo(apk))throw new IOException("无法保存安装包");
                say("下载与签名校验完成。");ui(()->{busy=false;new AlertDialog.Builder(activity).setTitle("新版已下载")
                    .setMessage("点击安装，由 Android 显示确认页面。若系统阻止，请勿关闭安全保护；可继续使用当前版本。")
                    .setNegativeButton("稍后",null).setPositiveButton("安装新版",(d,w)->install()).show();});
            }catch(Exception e){part.delete();say("下载或校验失败，未安装任何内容。请重新检查更新。");ui(()->busy=false);}
        },"lingo-update-download").start();
    }
    public void install(){
        File apk=new File(activity.getFilesDir(),"update.apk");
        if(!apk.isFile()){say("尚无已下载的更新，请先检查更新。");return;}
        try{
            if(!activity.getPackageManager().canRequestPackageInstalls()){
                new AlertDialog.Builder(activity).setTitle("需要你的安装许可")
                    .setMessage("如你信任本项目，可在系统页面允许听词研习室安装新版。返回后再次点“安装已下载更新”。安装后可撤销许可，不要关闭系统安全扫描。")
                    .setNegativeButton("取消",null).setPositiveButton("打开系统设置",(d,w)->activity.startActivity(new Intent("android.settings.MANAGE_UNKNOWN_APP_SOURCES",Uri.parse("package:"+activity.getPackageName())))).show();return;
            }
            Intent i=new Intent(Intent.ACTION_VIEW,Uri.parse("content://"+activity.getPackageName()+".update/update.apk"));
            i.setDataAndType(i.getData(),"application/vnd.android.package-archive");i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);activity.startActivity(i);
        }catch(Exception e){say("系统未允许安装，可继续使用当前版本或网页版。");}
    }
}
